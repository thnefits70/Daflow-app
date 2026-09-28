import { prisma } from "@/lib/prisma";
import { isoWeekOf } from "@/lib/autoFillRate";

// Confirmado 2026-09-28 con el usuario: desde la semana 2026-W40 la Ruptura
// de Stock se arma sola con los cortes de Fulfillment — un producto tuvo
// ruptura esa semana si Daniel confirmó que salió MENOS de lo pedido en
// algún corte. Solo cuenta lo que Daniel confirmó (lo que registra el equipo
// todavía puede cambiar). Ya no existe el formulario manual ni el botón
// "sin productos agotados"; las semanas anteriores quedan como Daniel las
// cargó a mano (StockoutWeekProduct / StockoutWeekConfirmation).
export const AUTO_STOCKOUT_FROM_WEEK = "2026-W40";
// Lunes de la semana 40 — los cortes se guardan por día (YYYY-MM-DD).
const AUTO_STOCKOUT_FROM_DAY = "2026-09-28";

export function isAutoStockoutWeek(week: string): boolean {
  return week >= AUTO_STOCKOUT_FROM_WEEK;
}

export type AutoStockoutProduct = { catalogItemId: string; name: string; justCode: string | null; needed: number; out: number };

// Semana -> productos con ruptura. Una semana aparece apenas tiene un corte
// enviado a Inventario, aunque todavía no falte nada (queda en 0).
export async function computeAutoStockoutWeeks(): Promise<Map<string, AutoStockoutProduct[]>> {
  const lots = await prisma.fulfillmentLot.findMany({
    where: { day: { gte: AUTO_STOCKOUT_FROM_DAY }, status: { in: ["SENT", "CLOSED"] } },
    select: {
      day: true,
      picks: { where: { confirmedAt: { not: null } }, select: { catalogItemId: true, confirmedQty: true } },
      batches: { select: { items: { select: { catalogItemId: true, quantity: true, warrantyGuide: true, warrantyMode: true } } } },
    },
  });

  // Semana -> producto -> pedido / salió (sumado en todos los cortes de la semana).
  const byWeek = new Map<string, Map<string, { needed: number; out: number; short: boolean }>>();
  for (const lot of lots) {
    const week = isoWeekOf(lot.day);
    if (!byWeek.has(week)) byWeek.set(week, new Map());
    const products = byWeek.get(week)!;

    // Lo pedido, igual que el corte (getCompiledLot): pedidos normales +
    // garantías, menos las de "solo una pieza" (salen de repuestos).
    const needed = new Map<string, number>();
    for (const b of lot.batches) {
      for (const it of b.items) {
        if (it.warrantyGuide && it.warrantyMode === "PIECE") continue;
        needed.set(it.catalogItemId, (needed.get(it.catalogItemId) ?? 0) + it.quantity);
      }
    }
    for (const p of lot.picks) {
      const qtyNeeded = needed.get(p.catalogItemId) ?? 0;
      if (qtyNeeded <= 0) continue;
      const out = Math.min(p.confirmedQty ?? 0, qtyNeeded);
      const cur = products.get(p.catalogItemId) ?? { needed: 0, out: 0, short: false };
      cur.needed += qtyNeeded;
      cur.out += out;
      if (out < qtyNeeded) cur.short = true;
      products.set(p.catalogItemId, cur);
    }
  }

  const ids = [...new Set([...byWeek.values()].flatMap((m) => [...m.entries()].filter(([, v]) => v.short).map(([id]) => id)))];
  const items = ids.length
    ? await prisma.purchaseCatalogItem.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, justCode: true } })
    : [];
  const itemById = new Map(items.map((i) => [i.id, i]));

  const result = new Map<string, AutoStockoutProduct[]>();
  for (const [week, products] of byWeek) {
    const list: AutoStockoutProduct[] = [];
    for (const [catalogItemId, v] of products) {
      if (!v.short) continue;
      const item = itemById.get(catalogItemId);
      list.push({ catalogItemId, name: item?.name ?? "Producto", justCode: item?.justCode ?? null, needed: v.needed, out: v.out });
    }
    result.set(week, list.sort((a, b) => a.name.localeCompare(b.name)));
  }
  return result;
}
