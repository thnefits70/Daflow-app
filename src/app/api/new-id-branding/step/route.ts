import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { notifyOwner } from "@/lib/notifications";
import { canBrandNewIds, getNewIdRealPhotosWatcherIds } from "@/lib/newIdBranding";

const schema = z
  .object({
    catalogItemId: z.string().min(1).nullable().optional(),
    proposalId: z.string().min(1).nullable().optional(),
    dropiComboId: z.string().min(1).nullable().optional(),
    step: z.enum(["dropiImages", "dropiInfo", "driveVideo", "realPhotos", "channel"]),
    done: z.boolean(),
    // Obligatoria al marcar "Imágenes brandeadas subidas a Dropi" (2026-10-10).
    brandedPhotoUrl: z.string().url().optional(),
  })
  .refine((d) => d.catalogItemId || d.proposalId || d.dropiComboId, { message: "Falta el producto." });

const STEP_FIELDS = {
  dropiImages: ["dropiImagesAt", "dropiImagesById"],
  dropiInfo: ["dropiInfoAt", "dropiInfoById"],
  driveVideo: ["driveVideoAt", "driveVideoById"],
  realPhotos: ["realPhotosAt", "realPhotosById"],
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

  // Pedido del usuario 2026-09-30: combos creados desde Sugerencias de
  // Combos — sus productos ya están en bodega, no tienen propuesta ni
  // llegadas propias.
  const dropiComboId = parsed.data.dropiComboId ?? null;
  let catalogItemId = dropiComboId ? null : parsed.data.catalogItemId ?? null;
  const proposalSelect = { id: true, productName: true, brandedAt: true, catalogItemId: true } as const;
  let proposal = parsed.data.proposalId && !dropiComboId
    ? await prisma.marketProductProposal.findUnique({ where: { id: parsed.data.proposalId }, select: proposalSelect })
    : null;
  if (parsed.data.proposalId && !proposal) return NextResponse.json({ error: "No encontrada." }, { status: 404 });
  if (!catalogItemId && proposal?.catalogItemId) catalogItemId = proposal.catalogItemId;
  if (catalogItemId && !proposal) {
    proposal = await prisma.marketProductProposal.findUnique({ where: { catalogItemId }, select: proposalSelect });
  }

  let row = dropiComboId
    ? await prisma.newIdBranding.findUnique({ where: { dropiComboId } })
    : await prisma.newIdBranding.findFirst({
        where: { OR: [...(catalogItemId ? [{ catalogItemId }] : []), ...(proposal ? [{ proposalId: proposal.id }] : [])] },
      });
  if (dropiComboId && !row) return NextResponse.json({ error: "No encontrado." }, { status: 404 });
  const legacyDone = catalogItemId
    ? !!(await prisma.purchaseReceiptFollowUp.findFirst({ where: { designConfirmedAt: { not: null }, request: { catalogItemId } }, select: { id: true } }))
    : false;
  const alreadyBranded = !!row?.brandedAt || legacyDone || !!proposal?.brandedAt;

  const afterBranding = step === "realPhotos" || step === "channel";
  if (afterBranding && !alreadyBranded) return NextResponse.json({ error: "Primero termina los pasos del brandeo." }, { status: 409 });
  if (!afterBranding && alreadyBranded) return NextResponse.json({ error: "Este producto ya está brandeado." }, { status: 409 });

  // Confirmado 2026-09-25, pedido de Robert: las fotos reales solo se pueden
  // tomar cuando el producto ya está físicamente en bodega, y recién con
  // ellas se sube al canal. Lo ya marcado en el canal antes de este cambio
  // sigue valiendo (se puede desmarcar sin pedir fotos reales).
  const arrived = dropiComboId
    ? true
    : afterBranding && done && catalogItemId
      ? !!(await prisma.purchaseRequest.findFirst({ where: { catalogItemId, status: { in: ["RECEIVED_PENDING_REVIEW", "RECEIVED"] } }, select: { id: true } }))
      : false;
  if (step === "realPhotos" && done && !arrived) {
    return NextResponse.json({ error: "Este producto todavía no llega a bodega." }, { status: 409 });
  }
  if (step === "realPhotos" && !done && row?.channelUploadedAt) {
    return NextResponse.json({ error: "Primero desmarca \"Subido al canal de la marca\"." }, { status: 409 });
  }
  // Pedido de Robert 2026-10-01: ya no hay atajo para lo brandeado antes —
  // al canal solo se sube lo que tiene imágenes reales completadas.
  if (step === "channel" && done && !row?.realPhotosAt) {
    return NextResponse.json({ error: "Primero marca las imágenes reales." }, { status: 409 });
  }

  // Pedido del usuario 2026-10-10: la imagen brandeada (con su marca) es
  // obligatoria al marcar este paso — es la que muestra provedix.com. Se
  // guarda en el producto (o en el combo); desmarcar no la borra.
  const brandedPhotoUrl = parsed.data.brandedPhotoUrl ?? null;
  if (step === "dropiImages" && done) {
    const storageBase = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
    if (!brandedPhotoUrl || !storageBase || !brandedPhotoUrl.startsWith(storageBase)) {
      return NextResponse.json({ error: "Adjunta una de las imágenes brandeadas para marcar este paso." }, { status: 400 });
    }
  }

  const [atField, byField] = STEP_FIELDS[step];
  const now = new Date();
  const userId = session.user.id;
  if (step === "dropiImages" && done && brandedPhotoUrl) {
    const photo = { brandedPhotoUrl, brandedPhotoAt: now, brandedPhotoById: userId };
    if (dropiComboId) await prisma.dropiCombo.update({ where: { id: dropiComboId }, data: photo });
    else if (catalogItemId) await prisma.purchaseCatalogItem.update({ where: { id: catalogItemId }, data: photo });
  }
  const stepData = done ? { [atField]: now, [byField]: userId } : { [atField]: null, [byField]: null };

  const hadRealPhotos = !!row?.realPhotosAt;
  row = row
    ? await prisma.newIdBranding.update({
        where: { id: row.id },
        data: { ...stepData, catalogItemId: row.catalogItemId ?? catalogItemId, proposalId: row.proposalId ?? proposal?.id ?? null },
      })
    : await prisma.newIdBranding.create({ data: { ...stepData, catalogItemId, proposalId: proposal?.id ?? null } });

  // Pedido de Robert 2026-10-01: con las imágenes reales completadas el
  // producto queda terminado — recién ahí se le avisa a Marcos
  // (notifyNewIdRealPhotos). Nunca antes.
  if (step === "realPhotos" && done && !hadRealPhotos) {
    const combo = dropiComboId
      ? (await prisma.newIdBranding.findUnique({ where: { id: row.id }, select: { dropiCombo: { select: { label: true, code: true } } } }))?.dropiCombo
      : null;
    const name = combo
      ? `Combo · ${combo.label ?? combo.code}`
      : catalogItemId
        ? (await prisma.purchaseCatalogItem.findUnique({ where: { id: catalogItemId }, select: { name: true } }))?.name
        : proposal?.productName;
    const watchers = await getNewIdRealPhotosWatcherIds();
    await Promise.all(
      watchers.map((uid) =>
        notifyOwner(uid, {
          title: "Producto nuevo con imágenes reales",
          body: `${name ?? "Un producto nuevo"} ya está completo: brandeado y con imágenes reales.`,
          url: "/area/workspace?tab=nuevos-ids",
        }).catch(() => null)
      )
    );
  }

  if (afterBranding || !row.dropiImagesAt || !row.dropiInfoAt || !row.driveVideoAt) {
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
