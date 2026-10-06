import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canViewStockLevels } from "@/lib/guards";
import { ecuadorDay } from "@/lib/fulfillmentGuides";
import { addDays, salesByItemDay } from "@/lib/suddenDemand";

// Pedido de Bryan 2026-10-06: tendencia de unidades despachadas por día en
// Stock Actual. Misma cuenta que "Productos que despiertan" (cortes
// guardados, combos ya separados, sin garantías de una sola pieza), últimos
// 30 días. Los días antes del primer corte guardado van en null (sin datos),
// no en 0, para no confundir "no había registro" con "no se vendió".
const DAYS = 30;

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await canViewStockLevels())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  const { id } = await params;

  const today = ecuadorDay(new Date());
  const fromDay = addDays(today, -(DAYS - 1));
  const [sales, firstBatch] = await Promise.all([
    salesByItemDay(fromDay, [id]),
    prisma.fulfillmentRequestBatch.findFirst({ orderBy: { requestedAt: "asc" }, select: { requestedAt: true } }),
  ]);
  const firstDay = firstBatch ? ecuadorDay(firstBatch.requestedAt) : today;
  const byDay = sales.get(id) ?? new Map<string, number>();

  const days: { day: string; units: number | null }[] = [];
  for (let i = 0; i < DAYS; i++) {
    const day = addDays(fromDay, i);
    days.push({ day, units: day < firstDay ? null : byDay.get(day) ?? 0 });
  }
  return NextResponse.json({ days, firstDay });
}
