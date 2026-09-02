import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canSubmitCancelledGuide, canViewAllCancelledGuides } from "@/lib/guards";
import { nextCancelledGuideNumber, formatCancelledGuideCode, notifyCancelledGuideSubmitted } from "@/lib/cancelledGuides";
import { MKT_CANCEL_REASONS, FULFILLMENT_CANCEL_REASONS } from "@/lib/cancelledGuidesLabels";

const REPORT_INCLUDE = {
  submittedBy: { select: { name: true } },
  items: { include: { catalogItem: { select: { name: true, photos: true, justCode: true } } } },
  fulfillmentConfirmedBy: { select: { name: true } },
  inventoryConfirmedBy: { select: { name: true } },
  cutoffDecidedBy: { select: { name: true } },
  reingresadoBy: { select: { name: true } },
} as const;

const schema = z.object({
  sourceArea: z.enum(["MKT_DAMIAN", "MKT_PROVEDIX", "FULFILLMENT"]),
  guideNumber: z.string().trim().min(1, "Falta el número de guía."),
  carrier: z.enum(["SERVIENTREGA", "URBANO", "GINTRANCOM", "LAARCOURIER", "VELOCES"]),
  reason: z.string().trim().min(1, "Falta el motivo."),
  items: z
    .array(z.object({ catalogItemId: z.string().min(1).optional(), declaredName: z.string().trim().min(1).optional(), quantity: z.number().int().positive() }))
    .default([]),
});

// Confirmado 2026-08-25: lista propia (asesores de MKT/FUL) o completa
// (líderes de MKT/FUL/INV + admin) — mismo endpoint, filtrado según quién
// pregunta.
export async function GET() {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const seeAll = await canViewAllCancelledGuides();
  if (!seeAll && !(await canSubmitCancelledGuide())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const reports = await prisma.cancelledGuideReport.findMany({
    where: seeAll ? {} : { submittedById: session.user.id },
    include: REPORT_INCLUDE,
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json(reports);
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!(await canSubmitCancelledGuide()) || !session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });

  const allowedReasons = parsed.data.sourceArea === "FULFILLMENT" ? [...FULFILLMENT_CANCEL_REASONS, "Otro"] : [...MKT_CANCEL_REASONS, "Otro"];
  const isKnownReason = allowedReasons.some((r) => parsed.data.reason === r) || parsed.data.reason.length > 0;
  if (!isKnownReason) return NextResponse.json({ error: "Motivo inválido." }, { status: 400 });

  const catalogIds = parsed.data.items.map((i) => i.catalogItemId).filter((id): id is string => !!id);
  const catalogItems = catalogIds.length
    ? await prisma.purchaseCatalogItem.findMany({ where: { id: { in: catalogIds } }, select: { id: true, name: true } })
    : [];
  const nameById = new Map(catalogItems.map((c) => [c.id, c.name]));

  const itemsData = [];
  for (const item of parsed.data.items) {
    if (!item.catalogItemId && !item.declaredName) return NextResponse.json({ error: "Falta el producto en uno de los renglones." }, { status: 400 });
    const declaredName = item.catalogItemId ? nameById.get(item.catalogItemId) : item.declaredName?.trim();
    if (!declaredName) return NextResponse.json({ error: "Producto no encontrado en el catálogo." }, { status: 404 });
    itemsData.push({ catalogItemId: item.catalogItemId ?? null, declaredName, quantity: item.quantity });
  }

  const reportNumber = await nextCancelledGuideNumber();
  const report = await prisma.cancelledGuideReport.create({
    data: {
      code: formatCancelledGuideCode(reportNumber),
      reportNumber,
      submittedById: session.user.id,
      sourceArea: parsed.data.sourceArea,
      guideNumber: parsed.data.guideNumber,
      carrier: parsed.data.carrier,
      reason: parsed.data.reason,
      items: { create: itemsData },
    },
    include: REPORT_INCLUDE,
  });

  await notifyCancelledGuideSubmitted(report.code, report.guideNumber);
  return NextResponse.json(report);
}
