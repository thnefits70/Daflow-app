import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import { HIGH_RETURN_MIN_OUT, RETURN_LAG_DAYS } from "@/lib/returnRate";
import { getVariantResolver, getVariantSales, MIX_MIN_UNITS } from "@/lib/variantSales";
import { getVariantStock } from "@/lib/variantStock";

// Venta real y compra por color (pedido del usuario 2026-10-16, plan aprobado):
// comprar para mantener el inventario moviéndose, no para llenar la bodega.
//
// 1. Venta real: de lo que sale por Dropi se descuenta lo que REGRESA EN BUEN
//    ESTADO (vuelve al stock, así que no hay que reponerlo). Lo dañado no se
//    descuenta: esa unidad igual se consumió. Las ventas externas no regresan.
//    Cada producto usa su propia tasa (últimos RETURN_WINDOW_DAYS días, con
//    las devoluciones corridas RETURN_LAG_DAYS como en la Tasa de Devolución);
//    con pocas salidas, la de su marca; si no, la general.
// 2. Por color/talla: si el producto tiene stock por color que cuadra con el
//    total, cada color se calcula solo — lo que vende ese color (ya sin sus
//    devoluciones) × (días del proveedor + cobertura) − lo que hay de ese color.
//    Un color que se vende mucho se pide aunque haya stock, si no alcanza; uno
//    que no se vende no se pide aunque esté en 0.
export const RETURN_WINDOW_DAYS = 60;
// Ningún producto descuenta más que esto, aunque en la ventana haya regresado
// casi todo (devoluciones de ventas viejas con pocas salidas nuevas).
const MAX_GOOD_RETURN_RATE = 0.8;
// Color "principal": el que hace al menos esta parte de las ventas. Solo esos
// pueden volver urgente al producto (un color que casi no sale y está en 0 no).
export const MAIN_COLOR_SHARE = 0.15;
// Diferencia máxima entre la suma de colores y el total para confiar en el desglose.
export const COLOR_TOLERANCE = 2;

const DAY_MS = 86_400_000;

export type ReturnSource = "producto" | "marca" | "general" | "sin_datos";
export type ReturnInfo = {
  // De cada unidad que sale por Dropi, qué parte regresa (todo) y qué parte vuelve al stock (buen estado).
  pct: number;
  goodPct: number;
  source: ReturnSource;
};
export type Demand = {
  // Unidades que salieron en la ventana (Dropi + ventas externas).
  gross: number;
  // Lo mismo sin lo que vuelve en buen estado.
  net: number;
  returns: ReturnInfo;
};

type ReturnData = {
  byItem: Map<string, ReturnInfo>;
  // Por producto y color: unidades que salieron y que regresaron (todas).
  colorOut: Map<string, Map<string, number>>;
  colorBack: Map<string, Map<string, number>>;
};

function rate(back: number, out: number): number {
  return out > 0 ? Math.min(1, back / out) : 0;
}

// Se lee una vez por minuto: Qué comprar lo pide dos veces por carga.
let returnCache: { at: number; data: Promise<ReturnData> } | null = null;
function getReturnData(): Promise<ReturnData> {
  if (returnCache && Date.now() - returnCache.at < 60_000) return returnCache.data;
  const data = loadReturnData();
  returnCache = { at: Date.now(), data };
  data.catch(() => { returnCache = null; });
  return data;
}

async function loadReturnData(): Promise<ReturnData> {
  const now = Date.now();
  const lag = RETURN_LAG_DAYS * DAY_MS;
  const first = await prisma.fulfillmentRequestBatch.findFirst({ orderBy: { requestedAt: "asc" }, select: { requestedAt: true } });
  const outFrom = Math.max(now - lag - RETURN_WINDOW_DAYS * DAY_MS, first?.requestedAt.getTime() ?? now);
  const outTo = now - lag;
  const empty: ReturnData = { byItem: new Map(), colorOut: new Map(), colorBack: new Map() };
  if (outFrom >= outTo) return empty;
  const outRange = { gte: new Date(outFrom), lt: new Date(outTo) };
  const backRange = { gte: new Date(outFrom + lag), lt: new Date(now) };

  const [outRows, backRows, outNotes, backColors, items, resolve] = await Promise.all([
    prisma.fulfillmentRequestItem.groupBy({ by: ["catalogItemId"], where: { warrantyGuide: null, batch: { requestedAt: outRange } }, _sum: { quantity: true } }),
    prisma.merchandiseReentryItem.groupBy({ by: ["catalogItemId"], where: { catalogItemId: { not: null }, batch: { submittedAt: backRange } }, _sum: { goodQty: true, damagedQty: true } }),
    prisma.fulfillmentRequestVariantNote.findMany({ where: { batch: { requestedAt: outRange } }, select: { catalogItemId: true, label: true, quantity: true } }),
    prisma.merchandiseReentryItem.findMany({ where: { catalogItemId: { not: null }, NOT: { variantCounts: { equals: Prisma.DbNull } }, batch: { submittedAt: backRange } }, select: { catalogItemId: true, variantCounts: true } }),
    prisma.purchaseCatalogItem.findMany({ select: { id: true, bodega: true } }),
    getVariantResolver(),
  ]);
  const brandOf = new Map(items.map((i) => [i.id, i.bodega ?? "SIN_MARCA"]));
  const out = new Map(outRows.map((r) => [r.catalogItemId, r._sum.quantity ?? 0]));
  const back = new Map(backRows.map((r) => [r.catalogItemId!, { all: (r._sum.goodQty ?? 0) + (r._sum.damagedQty ?? 0), good: r._sum.goodQty ?? 0 }]));

  const brand = new Map<string, { out: number; all: number; good: number }>();
  const total = { out: 0, all: 0, good: 0 };
  for (const id of new Set([...out.keys(), ...back.keys()])) {
    const o = out.get(id) ?? 0;
    const b = back.get(id) ?? { all: 0, good: 0 };
    const key = brandOf.get(id) ?? "SIN_MARCA";
    const cur = brand.get(key) ?? { out: 0, all: 0, good: 0 };
    cur.out += o;
    cur.all += b.all;
    cur.good += b.good;
    brand.set(key, cur);
    total.out += o;
    total.all += b.all;
    total.good += b.good;
  }

  const byItem = new Map<string, ReturnInfo>();
  for (const i of items) {
    const o = out.get(i.id) ?? 0;
    const b = back.get(i.id);
    const br = brand.get(i.bodega ?? "SIN_MARCA");
    const pick = o >= HIGH_RETURN_MIN_OUT
      ? { out: o, all: b?.all ?? 0, good: b?.good ?? 0, source: "producto" as const }
      : br && br.out >= HIGH_RETURN_MIN_OUT
        ? { ...br, source: "marca" as const }
        : total.out >= HIGH_RETURN_MIN_OUT
          ? { ...total, source: "general" as const }
          : null;
    byItem.set(i.id, pick ? { pct: rate(pick.all, pick.out), goodPct: Math.min(MAX_GOOD_RETURN_RATE, rate(pick.good, pick.out)), source: pick.source } : { pct: 0, goodPct: 0, source: "sin_datos" });
  }

  const add = (m: Map<string, Map<string, number>>, id: string, label: string, qty: number) => {
    let inner = m.get(id);
    if (!inner) m.set(id, (inner = new Map()));
    inner.set(label, (inner.get(label) ?? 0) + qty);
  };
  const colorOut = new Map<string, Map<string, number>>();
  for (const n of outNotes) {
    const label = resolve(n.catalogItemId, n.label);
    if (label && n.quantity > 0) add(colorOut, n.catalogItemId, label.toLowerCase(), n.quantity);
  }
  const colorBack = new Map<string, Map<string, number>>();
  for (const r of backColors) {
    if (!r.catalogItemId || !Array.isArray(r.variantCounts)) continue;
    for (const v of r.variantCounts as { name?: string; qty?: number }[]) {
      const label = v.name ? resolve(r.catalogItemId, v.name) : null;
      if (label && (v.qty ?? 0) > 0) add(colorBack, r.catalogItemId, label.toLowerCase(), v.qty!);
    }
  }
  return { byItem, colorOut, colorBack };
}

// Ventas de la ventana, brutas y reales, por producto. Mismo criterio de
// "venta" que getSoldUnitsByItem (garantías de una pieza no cuentan).
export async function getDemandByItem(windowStart: Date, catalogItemIds?: string[]): Promise<Map<string, Demand>> {
  const only = catalogItemIds ? { catalogItemId: { in: catalogItemIds } } : {};
  const [dropi, external, returns] = await Promise.all([
    prisma.fulfillmentRequestItem.groupBy({
      by: ["catalogItemId"],
      where: { ...only, batch: { requestedAt: { gte: windowStart } }, OR: [{ warrantyMode: null }, { warrantyMode: { not: "PIECE" } }] },
      _sum: { quantity: true },
    }),
    prisma.merchandiseOutflowItem.groupBy({
      by: ["catalogItemId"],
      where: { ...(catalogItemIds ? { catalogItemId: { in: catalogItemIds } } : { catalogItemId: { not: null } }), batch: { reason: "VENTA_EXTERNA", createdAt: { gte: windowStart } } },
      _sum: { quantity: true },
    }),
    getReturnData(),
  ]);
  const ext = new Map(external.filter((r) => r.catalogItemId).map((r) => [r.catalogItemId!, r._sum.quantity ?? 0]));
  const out = new Map<string, Demand>();
  const noData: ReturnInfo = { pct: 0, goodPct: 0, source: "sin_datos" };
  for (const r of dropi) {
    if (!r.catalogItemId) continue;
    const returns_ = returns.byItem.get(r.catalogItemId) ?? noData;
    const d = r._sum.quantity ?? 0;
    const e = ext.get(r.catalogItemId) ?? 0;
    out.set(r.catalogItemId, { gross: d + e, net: d * (1 - returns_.goodPct) + e, returns: returns_ });
  }
  for (const [id, e] of ext) {
    if (!out.has(id)) out.set(id, { gross: e, net: e, returns: returns.byItem.get(id) ?? noData });
  }
  return out;
}

export type ColorPlan = {
  name: string;
  stock: number;
  // Venta real por día de este color (ya sin lo que regresa en buen estado).
  perDay: number;
  // Parte de las ventas del producto que hace este color (0 a 1).
  share: number;
  // Qué parte de lo que sale de este color regresa (todo), si hay datos suficientes del color.
  returnPct: number | null;
  daysLeft: number | null;
  buy: number;
  main: boolean;
};
export type ColorBreakdown = { colors: ColorPlan[]; unidentified: number };
// Por qué un producto con colores no tiene compra por color.
export type ColorGap = "no_cuadra" | "sin_ventas_por_color";

// Compra por color para los productos que tienen stock por color. coverDays =
// días del proveedor + cobertura después de que llega, por producto.
export async function getColorPlans(
  items: { catalogItemId: string; grossPerDay: number; coverDays: number; returns: ReturnInfo }[],
): Promise<{ plans: Map<string, ColorBreakdown>; gaps: Map<string, ColorGap> }> {
  const plans = new Map<string, ColorBreakdown>();
  const gaps = new Map<string, ColorGap>();
  const ids = items.map((i) => i.catalogItemId);
  if (ids.length === 0) return { plans, gaps };
  const stock = await getVariantStock(ids);
  const withColors = ids.filter((id) => (stock.get(id)?.variants.length ?? 0) >= 2);
  if (withColors.length === 0) return { plans, gaps };
  const [{ products }, returns] = await Promise.all([getVariantSales({ days: 30, catalogItemIds: withColors }), getReturnData()]);
  const salesBy = new Map(products.map((p) => [p.catalogItemId, p]));

  for (const it of items) {
    const vs = stock.get(it.catalogItemId);
    if (!vs || vs.variants.length < 2) continue;
    if (Math.abs(vs.unidentified) > COLOR_TOLERANCE) {
      gaps.set(it.catalogItemId, "no_cuadra");
      continue;
    }
    // Solo cuentan las ventas de colores que están en la lista oficial.
    const official = new Set(vs.variants.map((v) => v.name.toLowerCase()));
    const sales = (salesBy.get(it.catalogItemId)?.variants ?? []).filter((v) => official.has(v.label.toLowerCase()));
    const salesUnits = sales.reduce((s, v) => s + v.units, 0);
    if (salesUnits < MIX_MIN_UNITS && it.grossPerDay > 0) {
      gaps.set(it.catalogItemId, "sin_ventas_por_color");
      continue;
    }
    const soldOf = new Map(sales.map((v) => [v.label.toLowerCase(), v.units]));
    const outC = returns.colorOut.get(it.catalogItemId);
    const backC = returns.colorBack.get(it.catalogItemId);
    // Parte de lo que regresa que vuelve en buen estado (la del producto).
    const goodShare = it.returns.pct > 0 ? it.returns.goodPct / it.returns.pct : 0;
    const colors: ColorPlan[] = vs.variants.map((v) => {
      const key = v.name.toLowerCase();
      const share = salesUnits > 0 ? (soldOf.get(key) ?? 0) / salesUnits : 0;
      const o = outC?.get(key) ?? 0;
      const ownPct = o >= HIGH_RETURN_MIN_OUT ? rate(backC?.get(key) ?? 0, o) : null;
      const goodPct = ownPct !== null ? Math.min(MAX_GOOD_RETURN_RATE, ownPct * goodShare) : it.returns.goodPct;
      const perDay = it.grossPerDay * share * (1 - goodPct);
      const buy = Math.max(0, Math.ceil(perDay * it.coverDays - Math.max(0, v.stock)));
      return { name: v.name, stock: v.stock, perDay, share, returnPct: ownPct, daysLeft: perDay > 0 ? Math.max(0, v.stock) / perDay : null, buy, main: share >= MAIN_COLOR_SHARE };
    });
    colors.sort((a, b) => b.share - a.share || b.stock - a.stock || a.name.localeCompare(b.name));
    plans.set(it.catalogItemId, { colors, unidentified: vs.unidentified });
  }
  return { plans, gaps };
}

// El color principal que se acaba primero (null si ninguno vende).
export function firstMainColorOut(plan: ColorBreakdown): ColorPlan | null {
  const main = plan.colors.filter((c) => c.main && c.daysLeft !== null);
  return main.length ? main.reduce((a, b) => (b.daysLeft! < a.daysLeft! ? b : a)) : null;
}

export function colorBuyTotal(plan: ColorBreakdown): number | null {
  const t = plan.colors.reduce((s, c) => s + c.buy, 0);
  return t > 0 ? t : null;
}
