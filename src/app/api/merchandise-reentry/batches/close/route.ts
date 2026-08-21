import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canCloseMerchandiseReentry } from "@/lib/guards";
import { groupItemsForJustUpload } from "@/lib/merchandiseReentry";

const ITEM_INCLUDE = { catalogItem: { select: { name: true, photos: true } }, damageReason: { select: { name: true } }, batch: { select: { code: true, danielApprovedAt: true } } } as const;

// Bandeja de Nairoby para lo bueno: "para ingresar a Just" — agrupado por
// nombre final de producto (ver groupItemsForJustUpload en
// lib/merchandiseReentry.ts). Lo dañado ya no pasa por acá: desde
// 2026-08-21 todo producto "no solucionado" (ver damageSolved) sigue el
// ciclo semanal de /api/merchandise-reentry/weekly-writeoff, sin
// excepción, para evitar el doble proceso reingreso+baja que reportó
// Daniel.
export async function GET() {
  if (!(await canCloseMerchandiseReentry())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const forJustItems = await prisma.merchandiseReentryItem.findMany({
    where: { goodQty: { gt: 0 }, justUploadedAt: null, batch: { danielApprovedAt: { not: null } } },
    include: ITEM_INCLUDE,
    orderBy: { createdAt: "asc" },
  });

  return NextResponse.json({ forJust: groupItemsForJustUpload(forJustItems) });
}
