import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { canSubmitFulfillmentRequest, dbUserId } from "@/lib/guards";
import { sendLotToInventory } from "@/lib/fulfillmentGuides";
import { recomputeAutoFillRate } from "@/lib/autoFillRate";
import { prisma } from "@/lib/prisma";

// Yair envía el corte a Inventario (la doble confirmación es en pantalla).
// Desde acá el corte queda cerrado para cambios y se avisa a Daniel — y a
// Bryan Ríos/Jariel si algo no alcanza en stock.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!(await canSubmitFulfillmentRequest()) || !session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  const { id } = await params;
  const result = await sendLotToInventory(id, dbUserId(session.user.id));
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  // Fill Rate automático (desde 2026-W40): las guías de este corte ya cuentan.
  const lot = await prisma.fulfillmentLot.findUnique({ where: { id }, select: { day: true } });
  if (lot) await recomputeAutoFillRate(lot.day).catch((e) => console.error("[fill rate auto]", e));
  return NextResponse.json({ ok: true });
}
