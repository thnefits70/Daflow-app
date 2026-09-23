import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { notifyOwner } from "@/lib/notifications";
import { canBrandNewIds } from "@/lib/newIdBranding";

const schema = z
  .object({
    catalogItemId: z.string().min(1).nullable().optional(),
    proposalId: z.string().min(1).nullable().optional(),
    step: z.enum(["dropiImages", "dropiInfo", "driveVideo", "channel"]),
    done: z.boolean(),
  })
  .refine((d) => d.catalogItemId || d.proposalId, { message: "Falta el producto." });

const STEP_FIELDS = {
  dropiImages: ["dropiImagesAt", "dropiImagesById"],
  dropiInfo: ["dropiInfoAt", "dropiInfoById"],
  driveVideo: ["driveVideoAt", "driveVideoById"],
  channel: ["channelUploadedAt", "channelUploadedById"],
} as const;

// Confirmado 2026-09-23, pedido de Robert (corregido el mismo día): el
// brandeo se hace fuera de DAFLOW — imágenes brandeadas e información en
// Dropi, videos en Google Drive. Acá Robert solo marca cada paso hecho para
// que el resto del flujo sepa en qué va. Con los 3 pasos marcados el producto
// queda brandeado (pasa al historial) y recién ahí se puede marcar "subido
// al canal de la marca". Un paso se puede desmarcar mientras el brandeo no
// esté completo; el del canal, siempre.
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session || !(await canBrandNewIds())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });
  const { step, done } = parsed.data;

  let catalogItemId = parsed.data.catalogItemId ?? null;
  const proposalSelect = { id: true, productName: true, brandedAt: true, catalogItemId: true } as const;
  let proposal = parsed.data.proposalId
    ? await prisma.marketProductProposal.findUnique({ where: { id: parsed.data.proposalId }, select: proposalSelect })
    : null;
  if (parsed.data.proposalId && !proposal) return NextResponse.json({ error: "No encontrada." }, { status: 404 });
  if (!catalogItemId && proposal?.catalogItemId) catalogItemId = proposal.catalogItemId;
  if (catalogItemId && !proposal) {
    proposal = await prisma.marketProductProposal.findUnique({ where: { catalogItemId }, select: proposalSelect });
  }

  let row = await prisma.newIdBranding.findFirst({
    where: { OR: [...(catalogItemId ? [{ catalogItemId }] : []), ...(proposal ? [{ proposalId: proposal.id }] : [])] },
  });
  const legacyDone = catalogItemId
    ? !!(await prisma.purchaseReceiptFollowUp.findFirst({ where: { designConfirmedAt: { not: null }, request: { catalogItemId } }, select: { id: true } }))
    : false;
  const alreadyBranded = !!row?.brandedAt || legacyDone || !!proposal?.brandedAt;

  if (step === "channel" && !alreadyBranded) return NextResponse.json({ error: "Primero termina los pasos del brandeo." }, { status: 409 });
  if (step !== "channel" && alreadyBranded) return NextResponse.json({ error: "Este producto ya está brandeado." }, { status: 409 });

  const [atField, byField] = STEP_FIELDS[step];
  const now = new Date();
  const userId = session.user.id;
  const stepData = done ? { [atField]: now, [byField]: userId } : { [atField]: null, [byField]: null };

  row = row
    ? await prisma.newIdBranding.update({
        where: { id: row.id },
        data: { ...stepData, catalogItemId: row.catalogItemId ?? catalogItemId, proposalId: row.proposalId ?? proposal?.id ?? null },
      })
    : await prisma.newIdBranding.create({ data: { ...stepData, catalogItemId, proposalId: proposal?.id ?? null } });

  if (step === "channel" || !row.dropiImagesAt || !row.dropiInfoAt || !row.driveVideoAt) {
    return NextResponse.json({ ok: true, branded: false });
  }

  // Los 3 pasos listos: queda brandeado. Todas las llegadas de este producto
  // quedan con el diseño confirmado (así el aviso en pantalla no las sigue
  // contando) y la propuesta de Análisis de Mercado, si hay, queda brandeada.
  await prisma.$transaction(async (tx) => {
    await tx.newIdBranding.update({ where: { id: row!.id }, data: { brandedAt: now, brandedById: userId } });
    if (catalogItemId) {
      const requests = await tx.purchaseRequest.findMany({
        where: { catalogItemId, status: { in: ["RECEIVED_PENDING_REVIEW", "RECEIVED"] } },
        select: { id: true },
      });
      for (const r of requests) {
        await tx.purchaseReceiptFollowUp.upsert({
          where: { requestId: r.id },
          update: { designConfirmedAt: now, designConfirmedById: userId },
          create: { requestId: r.id, designConfirmedAt: now, designConfirmedById: userId },
        });
      }
    }
    if (proposal) {
      await tx.marketProductProposal.update({ where: { id: proposal.id }, data: { brandedAt: now, brandedById: userId } });
    }
  });

  if (proposal) {
    const marketingLead = await prisma.user.findFirst({ where: { isLeader: true, leadsDept: { code: "MKT" } }, select: { id: true } });
    if (marketingLead) {
      await notifyOwner(marketingLead.id, {
        title: "Producto listo — trazabilidad completa",
        body: `${proposal.productName} ya terminó todo el proceso.`,
        url: "/area/workspace?tab=analisis-mercado",
      }).catch(() => null);
    }
  }

  return NextResponse.json({ ok: true, branded: true });
}
