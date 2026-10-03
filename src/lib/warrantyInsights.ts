import { prisma } from "@/lib/prisma";
import { guayaquilMonth } from "@/lib/warrantyKpi";
import { WARRANTY_AUTO_SINCE_MONTH, isAutoWarrantyMonth } from "@/lib/warrantyKpiConstants";
import { WARRANTY_PICKUP_FREIGHT_AVG } from "@/lib/localWarrantyConstants";
import { bodegaUnitCost, resolveCostBasisForCatalogItems } from "@/lib/marketProduct";
import { DROPI_INSURANCE_DEFAULT } from "@/lib/dropiPricing";

// Pedidos del usuario 2026-10-03 sobre los KPIs de garantías:
// 1. Las garantías locales (GL-000X) NO suman al total del mes, pero sus
//    motivos SÍ se suman a los gráficos de motivos (todas las razones reales).
// 2. Los motivos se separan en "Falla del producto" y "Error de bodega".
// 3. Tasa del mes: garantías ÷ pedidos despachados, en % sin decimales.
// 4. Productos con más fallas (para reclamar o dejar de comprar).
// 5. Cuánto cuestan las garantías en plata — solo admin y Nairoby (FIN).

const GYE_OFFSET_MS = 5 * 60 * 60 * 1000;

export type WarrantyReasonGroup = "PRODUCTO" | "BODEGA" | "OTRO";

// Por nombre de la categoría (las crea Finanzas a mano; hoy son 4).
export function warrantyReasonGroup(name: string): WarrantyReasonGroup {
  const n = name.toLowerCase();
  if (n.includes("funcion") || n.includes("roto") || n.includes("dañad") || n.includes("defect")) return "PRODUCTO";
  if (n.includes("incomplet") || n.includes("diferent") || n.includes("equivoc") || n.includes("de más")) return "BODEGA";
  return "OTRO";
}

export const WARRANTY_GROUP_LABEL: Record<WarrantyReasonGroup, string> = {
  PRODUCTO: "Falla del producto",
  BODEGA: "Error de bodega",
  OTRO: "Otros",
};

// Motivo de la garantía local → nombre de la categoría del KPI.
const LOCAL_REASON_CATEGORY: Record<string, string> = {
  MAL_FUNCIONAMIENTO: "Mal funcionamiento",
  PRODUCTO_ROTO: "Producto roto",
  ORDEN_INCOMPLETA: "Pedido incompleto",
  ORDEN_DIFERENTE: "Pedido diferente",
};

export function monthRange(month: string): { from: Date; to: Date } {
  const [y, m] = month.split("-").map(Number);
  return { from: new Date(Date.UTC(y, m - 1, 1) + GYE_OFFSET_MS), to: new Date(Date.UTC(y, m, 1) + GYE_OFFSET_MS) };
}

// Motivos de las garantías locales por mes (cada garantía cuenta una vez por
// motivo, igual que una guía de garantía de los cortes). Solo desde octubre.
export async function getLocalWarrantyReasonCounts(months: string[]): Promise<Map<string, Map<string, number>>> {
  const wanted = months.filter((m) => m >= WARRANTY_AUTO_SINCE_MONTH);
  const out = new Map<string, Map<string, number>>();
  if (wanted.length === 0) return out;
  const sorted = [...wanted].sort();
  const from = monthRange(sorted[0]).from;
  const to = monthRange(sorted[sorted.length - 1]).to;
  const sales = await prisma.externalSale.findMany({
    where: { kind: "WARRANTY", deletedAt: null, createdAt: { gte: from, lt: to } },
    select: { createdAt: true, items: { where: { warrantyRole: "DELIVER", warrantyReason: { not: null } }, select: { warrantyReason: true } } },
  });
  for (const s of sales) {
    const month = guayaquilMonth(s.createdAt);
    if (!wanted.includes(month)) continue;
    const reasons = new Set(s.items.map((i) => LOCAL_REASON_CATEGORY[i.warrantyReason!]).filter(Boolean));
    if (!out.has(month)) out.set(month, new Map());
    const byName = out.get(month)!;
    for (const r of reasons) byName.set(r, (byName.get(r) ?? 0) + 1);
  }
  return out;
}

// Guías de pedidos despachados en el mes (sin las guías de garantía).
export async function getMonthOrderCount(month: string): Promise<number> {
  const { from, to } = monthRange(month);
  const [guides, warranty] = await Promise.all([
    prisma.fulfillmentRequestGuide.findMany({ where: { batch: { requestedAt: { gte: from, lt: to } } }, select: { guideNumber: true } }),
    prisma.fulfillmentRequestItem.findMany({ where: { warrantyGuide: { not: null }, batch: { requestedAt: { gte: from, lt: to } } }, select: { warrantyGuide: true }, distinct: ["warrantyGuide"] }),
  ]);
  const warrantySet = new Set(warranty.map((w) => w.warrantyGuide));
  return guides.filter((g) => !warrantySet.has(g.guideNumber)).length;
}

// Tasa del mes en % sin decimales (pedido del usuario). null si el mes no
// es automático (antes de octubre no hay pedidos registrados para dividir).
export async function getWarrantyRate(month: string, total: number): Promise<{ orders: number; ratePct: number } | null> {
  if (!isAutoWarrantyMonth(month)) return null;
  const orders = await getMonthOrderCount(month);
  if (orders === 0) return null;
  return { orders, ratePct: Math.round((total / orders) * 100) };
}

export type WarrantyProductRow = { catalogItemId: string; name: string; code: string | null; product: number; bodega: number; out: number; pct: number | null };

// Productos con más garantías en los últimos 30 días (cortes + locales),
// ordenados por fallas del producto — los errores de bodega no son culpa
// del producto, se muestran aparte. pct = fallas ÷ unidades vendidas.
export async function getTopWarrantyProducts(limit = 5): Promise<WarrantyProductRow[]> {
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const [corteItems, localSales, outRows] = await Promise.all([
    prisma.fulfillmentRequestItem.findMany({
      where: { warrantyGuide: { not: null }, batch: { requestedAt: { gte: since } } },
      select: { catalogItemId: true, warrantyGuide: true, warrantyCategory: { select: { name: true } } },
    }),
    prisma.externalSale.findMany({
      where: { kind: "WARRANTY", deletedAt: null, createdAt: { gte: since } },
      select: { id: true, items: { where: { warrantyRole: "DELIVER", warrantyReason: { not: null }, catalogItemId: { not: null } }, select: { catalogItemId: true, warrantyReason: true } } },
    }),
    prisma.fulfillmentRequestItem.groupBy({ by: ["catalogItemId"], where: { warrantyGuide: null, batch: { requestedAt: { gte: since } } }, _sum: { quantity: true } }),
  ]);
  // Una garantía cuenta una vez por producto (guía o GL).
  const seen = new Set<string>();
  const counts = new Map<string, { product: number; bodega: number }>();
  const add = (key: string, catalogItemId: string, group: WarrantyReasonGroup) => {
    if (seen.has(key)) return;
    seen.add(key);
    const c = counts.get(catalogItemId) ?? { product: 0, bodega: 0 };
    if (group === "BODEGA") c.bodega++;
    else c.product++;
    counts.set(catalogItemId, c);
  };
  for (const i of corteItems) add(`${i.warrantyGuide}:${i.catalogItemId}`, i.catalogItemId, i.warrantyCategory ? warrantyReasonGroup(i.warrantyCategory.name) : "OTRO");
  for (const s of localSales) for (const i of s.items) add(`${s.id}:${i.catalogItemId}`, i.catalogItemId!, warrantyReasonGroup(LOCAL_REASON_CATEGORY[i.warrantyReason!] ?? ""));
  if (counts.size === 0) return [];
  const outById = new Map(outRows.map((r) => [r.catalogItemId, r._sum.quantity ?? 0]));
  const items = await prisma.purchaseCatalogItem.findMany({ where: { id: { in: [...counts.keys()] } }, select: { id: true, name: true, justCode: true } });
  const byId = new Map(items.map((i) => [i.id, i]));
  return [...counts.entries()]
    .map(([id, c]) => {
      const out = outById.get(id) ?? 0;
      return { catalogItemId: id, name: byId.get(id)?.name ?? "—", code: byId.get(id)?.justCode ?? null, product: c.product, bodega: c.bodega, out, pct: out > 0 ? Math.round((c.product / out) * 100) : null };
    })
    .sort((a, b) => b.product - a.product || b.bodega - a.bodega)
    .slice(0, limit);
}

export type WarrantyCostMonth = { month: string; warranties: number; productCost: number; freight: number; total: number; reserve: number; soldCost: number };

// Cuánto costaron las garantías del mes contra lo que guardó el seguro (6%
// del costo de lo vendido en los cortes). Producto al costo puesto en bodega
// de hoy; flete promedio $6 por envío (y $6 más si se recogió algo). En las
// locales se usa el flete real si se registró.
export async function getWarrantyCostMonth(month: string): Promise<WarrantyCostMonth> {
  const { from, to } = monthRange(month);
  const [corteItems, soldRows, localSales] = await Promise.all([
    prisma.fulfillmentRequestItem.findMany({ where: { warrantyGuide: { not: null }, batch: { requestedAt: { gte: from, lt: to } } }, select: { catalogItemId: true, quantity: true, warrantyGuide: true } }),
    prisma.fulfillmentRequestItem.groupBy({ by: ["catalogItemId"], where: { warrantyGuide: null, batch: { requestedAt: { gte: from, lt: to } } }, _sum: { quantity: true } }),
    prisma.externalSale.findMany({
      where: { kind: "WARRANTY", deletedAt: null, createdAt: { gte: from, lt: to } },
      select: { freightCost: true, items: { select: { catalogItemId: true, quantity: true, warrantyRole: true, warrantyReason: true } } },
    }),
  ]);
  const ids = new Set<string>([...corteItems.map((i) => i.catalogItemId), ...soldRows.map((r) => r.catalogItemId)]);
  for (const s of localSales) for (const i of s.items) if (i.catalogItemId) ids.add(i.catalogItemId);
  const bases = await resolveCostBasisForCatalogItems([...ids]);
  const cost = (id: string | null) => {
    const b = id ? bases.get(id) : null;
    return b ? bodegaUnitCost(b.batchCost, b.freightCost, b.batchUnits) : 0;
  };

  let productCost = 0;
  let freight = 0;
  const guides = new Set<string>();
  for (const i of corteItems) {
    productCost += i.quantity * cost(i.catalogItemId);
    guides.add(i.warrantyGuide!);
  }
  freight += guides.size * WARRANTY_PICKUP_FREIGHT_AVG;
  for (const s of localSales) {
    // Solo sale producto nuevo de bodega por mal funcionamiento o roto (en
    // incompleto/diferente esa unidad ya se había descontado en el corte).
    for (const i of s.items) {
      if (i.warrantyRole === "DELIVER" && (i.warrantyReason === "MAL_FUNCIONAMIENTO" || i.warrantyReason === "PRODUCTO_ROTO")) productCost += i.quantity * cost(i.catalogItemId);
    }
    freight += s.freightCost ?? WARRANTY_PICKUP_FREIGHT_AVG;
    if (s.items.some((i) => i.warrantyRole === "PICKUP")) freight += WARRANTY_PICKUP_FREIGHT_AVG;
  }
  const soldCost = soldRows.reduce((sum, r) => sum + (r._sum.quantity ?? 0) * cost(r.catalogItemId), 0);
  const round2 = (n: number) => Math.round(n * 100) / 100;
  return {
    month,
    warranties: guides.size + localSales.length,
    productCost: round2(productCost),
    freight: round2(freight),
    total: round2(productCost + freight),
    reserve: round2((soldCost * DROPI_INSURANCE_DEFAULT) / 100),
    soldCost: round2(soldCost),
  };
}

export function currentGuayaquilMonth(): string {
  return guayaquilMonth(new Date());
}

export function previousMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 2, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

// Este mes y el anterior (los cortes empezaron el 21 de septiembre 2026).
export async function getWarrantyCostOverview(): Promise<{ current: WarrantyCostMonth; previous: WarrantyCostMonth | null }> {
  const month = currentGuayaquilMonth();
  const prev = previousMonth(month);
  const [current, previous] = await Promise.all([getWarrantyCostMonth(month), prev >= "2026-09" ? getWarrantyCostMonth(prev) : Promise.resolve(null)]);
  return { current, previous };
}

// Pedido del usuario 2026-10-03: TODO el equipo ve en Inicio cuánto se
// perdió en garantías (total + producto dañado + fletes perdidos). El 6% nunca
// sale en Inicio (vive en KPIs financieros) — se recorta acá en el servidor
// para que ni llegue a la página.
export type WarrantyLossMonth = { month: string; warranties: number; total: number; productCost: number; freight: number };
export type WarrantyLossOverview = { current: WarrantyLossMonth; previous: WarrantyLossMonth | null };

export async function getWarrantyLossOverview(): Promise<WarrantyLossOverview> {
  const { current, previous } = await getWarrantyCostOverview();
  const strip = (m: WarrantyCostMonth): WarrantyLossMonth => ({
    month: m.month,
    warranties: m.warranties,
    total: m.total,
    productCost: m.productCost,
    freight: m.freight,
  });
  return { current: strip(current), previous: previous ? strip(previous) : null };
}
