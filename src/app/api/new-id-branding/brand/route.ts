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
    photos: z.array(z.string().url()).min(1, "Sube al menos 1 foto real brandeada.").max(10),
    videoUrls: z.array(z.string().url()).min(1, "Sube el video o pega el enlace de Drive.").max(5),
  })
  .refine((d) => d.catalogItemId || d.proposalId, { message: "Falta el producto." });

const proposalSelect = { id: true, productName: true, description: true, brandedAt: true, catalogItemId: true } as const;

// Confirmado 2026-09-23, pedido de Robert: terminar el brandeo de un ID nuevo
// (una sola vez por producto). Reemplaza tanto el botón "Confirmar fotos y
// video subidos" de Mercadería recibida como la vieja pestaña "Brandear" de
// Análisis de Mercado, por eso también marca esas dos cosas como hechas.
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session || !(await canBrandNewIds())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });
  const { photos, videoUrls } = parsed.data;

  let catalogItemId = parsed.data.catalogItemId ?? null;
  let proposal = parsed.data.proposalId
    ? await prisma.marketProductProposal.findUnique({ where: { id: parsed.data.proposalId }, select: proposalSelect })
    : null;
  if (parsed.data.proposalId && !proposal) return NextResponse.json({ error: "No encontrada." }, { status: 404 });
  if (!catalogItemId && proposal?.catalogItemId) catalogItemId = proposal.catalogItemId;
  if (catalogItemId && !proposal) {
    proposal = await prisma.marketProductProposal.findUnique({ where: { catalogItemId }, select: proposalSelect });
  }
  if (catalogItemId) {
    const item = await prisma.purchaseCatalogItem.findUnique({ where: { id: catalogItemId }, select: { id: true } });
    if (!item) return NextResponse.json({ error: "Producto no encontrado." }, { status: 404 });
  }

  const existing = await prisma.newIdBranding.findFirst({
    where: { OR: [...(catalogItemId ? [{ catalogItemId }] : []), ...(proposal ? [{ proposalId: proposal.id }] : [])] },
  });
  const legacyDone = catalogItemId
    ? await prisma.purchaseReceiptFollowUp.findFirst({ where: { designConfirmedAt: { not: null }, request: { catalogItemId } }, select: { id: true } })
    : null;
  if (existing?.brandedAt || legacyDone || proposal?.brandedAt) return NextResponse.json({ error: "Este producto ya está brandeado." }, { status: 409 });

  const now = new Date();
  const userId = session.user.id;
  const data = { photos, videoUrls, brandedAt: now, brandedById: userId };
  await prisma.$transaction(async (tx) => {
    if (existing) {
      await tx.newIdBranding.update({
        where: { id: existing.id },
        data: { ...data, catalogItemId: existing.catalogItemId ?? catalogItemId, proposalId: existing.proposalId ?? proposal?.id ?? null },
      });
    } else {
      await tx.newIdBranding.create({ data: { ...data, catalogItemId, proposalId: proposal?.id ?? null } });
    }
    // Todas las llegadas de este producto quedan con el diseño confirmado,
    // así el aviso en pantalla de Mercadería recibida no las sigue contando.
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
      // Igual que la vieja pestaña "Brandear": el catálogo de una propuesta
      // nace con la foto de referencia de la competencia, se reemplaza por
      // las fotos reales brandeadas.
      if (catalogItemId && proposal.catalogItemId === catalogItemId) {
        await tx.purchaseCatalogItem.update({
          where: { id: catalogItemId },
          data: { photos, ...(proposal.description ? { description: proposal.description } : {}) },
        });
      }
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

  return NextResponse.json({ ok: true });
}
