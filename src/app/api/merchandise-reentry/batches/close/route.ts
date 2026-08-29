import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canCloseMerchandiseReentry, canManageJustUpload, canApproveMerchandiseReentry } from "@/lib/guards";
import { groupItemsForJustUpload, JUST_UPLOAD_MIN_QTY, isTodayLastBusinessDayOfWeek, lastBusinessDayOfWeek } from "@/lib/merchandiseReentry";

const ITEM_INCLUDE = { catalogItem: { select: { name: true, photos: true, justCode: true } }, damageReason: { select: { name: true } }, batch: { select: { code: true, danielApprovedAt: true } } } as const;

// Bandeja de Nairoby para lo bueno: "para ingresar a Just" — agrupado por
// nombre final de producto (ver groupItemsForJustUpload en
// lib/merchandiseReentry.ts). Lo dañado ya no pasa por acá: desde
// 2026-08-21 todo producto "no solucionado" (ver damageSolved) sigue el
// ciclo semanal de /api/merchandise-reentry/weekly-writeoff, sin
// excepción, para evitar el doble proceso reingreso+baja que reportó
// Daniel.
export async function GET() {
  // Daniel (canApprove, líder de Inventario) ve esta bandeja en modo solo
  // lectura desde 2026-08-24 — bloqueado el 24-08-24 tras revertirle el
  // botón de acción (ver canManageJustUpload en guards.ts).
  const [canClose, canManage, canApprove] = await Promise.all([
    canCloseMerchandiseReentry(),
    canManageJustUpload(),
    canApproveMerchandiseReentry(),
  ]);
  if (!canClose && !canManage && !canApprove) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const forJustItems = await prisma.merchandiseReentryItem.findMany({
    where: { goodQty: { gt: 0 }, justUploadedAt: null, batch: { danielApprovedAt: { not: null } } },
    include: ITEM_INCLUDE,
    orderBy: { createdAt: "asc" },
  });

  // Confirmado 2026-08-23: un producto con MÁS de JUST_UPLOAD_MIN_QTY
  // unidades se puede subir apenas esté listo; con esa cantidad o menos,
  // espera al último día laboral de la semana (lunes-viernes,
  // sensible a feriados) para subirse junto con el resto de lo chico.
  const todayQualifies = isTodayLastBusinessDayOfWeek();
  const nextEligibleDay = todayQualifies ? null : lastBusinessDayOfWeek(new Date());
  const forJust = groupItemsForJustUpload(forJustItems).map((g) => ({
    ...g,
    canUploadNow: g.totalGoodQty > JUST_UPLOAD_MIN_QTY || todayQualifies,
  }));

  return NextResponse.json({ forJust, justUploadMinQty: JUST_UPLOAD_MIN_QTY, nextEligibleDay });
}
