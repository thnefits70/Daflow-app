import { prisma } from "@/lib/prisma";
import { RETURN_RATE_AUTO_SINCE_MONTH } from "@/lib/returnRateConstants";
import type { MarketProductBodega } from "@/generated/prisma/client";

// Pedido del usuario 2026-09-30: Tasa de Devolución automática, general,
// por marca y por producto — SIN anotar números de guía (pedido explícito:
// basta con saber qué producto regresó). Se compara, por producto, lo que
// salió en los cortes contra lo que regresó por Reingreso de Mercadería.
// Una devolución tarda entre 7 y 20 días en regresar, así que las
// devoluciones se miden corridas RETURN_LAG_DAYS (el punto medio): la tasa de
// octubre = lo que regresó del 15-oct al 14-nov ÷ lo que salió en octubre.
// El mes queda "preliminar" hasta RETURN_CLOSE_DAYS después de terminar.
// Se cuenta en UNIDADES (no pedidos), por eso puede diferir un poco de ATOM.
export const RETURN_LAG_DAYS = 14;
export const RETURN_CLOSE_DAYS = 20;
// Producto que "regresa mucho": 15% o más, con al menos 10 unidades salidas
// (para que 1 devolución de 2 ventas no salga como 50%).
export const HIGH_RETURN_PCT = 15;
export const HIGH_RETURN_MIN_OUT = 10;

const DAY_MS = 24 * 60 * 60 * 1000;
// Guayaquil es UTC-5 todo el año.
const GYE_OFFSET_MS = 5 * 60 * 60 * 1000;

export type ReturnRateRow = { key: string; name: string; out: number; returned: number; pct: number | null; high: boolean };
export type ReturnRateMonth = {
  month: string;
  closed: boolean;
  out: number;
  returned: number;
  pct: number | null;
  byBrand: ReturnRateRow[];
  byProduct: ReturnRateRow[];
};

const BRAND_LABELS: Record<MarketProductBodega, string> = {
  MKT_PROVEDIX: "Provedix",
  MKT_DAMIAN: "Importadora Damián",
  MKT_SHANGHAI: "Importadora Shanghai",
  MKT_SUMINISTROS: "Suministros",
};

const pctOf = (returned: number, out: number) => (out > 0 ? Math.round((returned / out) * 1000) / 10 : null);

function monthRange(month: string): { from: Date; to: Date } {
  const [y, m] = month.split("-").map(Number);
  return { from: new Date(Date.UTC(y, m - 1, 1) + GYE_OFFSET_MS), to: new Date(Date.UTC(y, m, 1) + GYE_OFFSET_MS) };
}

function guayaquilMonthOf(d: Date): string {
  const g = new Date(d.getTime() - GYE_OFFSET_MS);
  return `${g.getUTCFullYear()}-${String(g.getUTCMonth() + 1).padStart(2, "0")}`;
}

async function unitsByItem(outFrom: Date, outTo: Date, retFrom: Date, retTo: Date) {
  const [outRows, retRows] = await Promise.all([
    // Lo que salió en los cortes (las garantías no son ventas).
    prisma.fulfillmentRequestItem.groupBy({
      by: ["catalogItemId"],
      where: { warrantyGuide: null, batch: { requestedAt: { gte: outFrom, lt: outTo } } },
      _sum: { quantity: true },
    }),
    // Lo que regresó (bueno + dañado), una vez enviado el lote de Reingreso.
    prisma.merchandiseReentryItem.groupBy({
      by: ["catalogItemId"],
      where: { catalogItemId: { not: null }, batch: { submittedAt: { gte: retFrom, lt: retTo } } },
      _sum: { goodQty: true, damagedQty: true },
    }),
  ]);
  const out = new Map(outRows.map((r) => [r.catalogItemId, r._sum.quantity ?? 0]));
  const returned = new Map(retRows.map((r) => [r.catalogItemId!, (r._sum.goodQty ?? 0) + (r._sum.damagedQty ?? 0)]));
  return { out, returned };
}

async function buildRows(out: Map<string, number>, returned: Map<string, number>) {
  const ids = [...new Set([...out.keys(), ...returned.keys()])];
  const items = ids.length ? await prisma.purchaseCatalogItem.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, bodega: true } }) : [];
  const byId = new Map(items.map((i) => [i.id, i]));

  const byProduct: ReturnRateRow[] = ids.map((id) => {
    const o = out.get(id) ?? 0;
    const r = returned.get(id) ?? 0;
    const pct = pctOf(r, o);
    return { key: id, name: byId.get(id)?.name ?? "Producto", out: o, returned: r, pct, high: pct !== null && pct >= HIGH_RETURN_PCT && o >= HIGH_RETURN_MIN_OUT };
  });
  // Lo que más regresa arriba, entre los que salieron lo suficiente para que
  // el % signifique algo; los de pocas salidas al final.
  const enough = (r: ReturnRateRow) => (r.out >= HIGH_RETURN_MIN_OUT ? 1 : 0);
  byProduct.sort((a, b) => enough(b) - enough(a) || (b.pct ?? -1) - (a.pct ?? -1) || b.returned - a.returned);

  const brandAgg = new Map<string, { out: number; returned: number }>();
  for (const p of byProduct) {
    const brand = byId.get(p.key)?.bodega;
    const label = brand ? BRAND_LABELS[brand] : "Sin marca";
    const cur = brandAgg.get(label) ?? { out: 0, returned: 0 };
    cur.out += p.out;
    cur.returned += p.returned;
    brandAgg.set(label, cur);
  }
  const byBrand: ReturnRateRow[] = [...brandAgg.entries()]
    .map(([name, v]) => {
      const pct = pctOf(v.returned, v.out);
      return { key: name, name, out: v.out, returned: v.returned, pct, high: pct !== null && pct >= HIGH_RETURN_PCT };
    })
    .sort((a, b) => b.out - a.out);

  const totalOut = byProduct.reduce((s, p) => s + p.out, 0);
  const totalReturned = byProduct.reduce((s, p) => s + p.returned, 0);
  return { byProduct, byBrand, out: totalOut, returned: totalReturned, pct: pctOf(totalReturned, totalOut) };
}

// La tasa por producto solo tiene sentido si el producto salió en el
// período: lo que regresó sin haber salido (ventas de antes) no se lista
// por producto, pero sí cuenta en el total general y por marca.
export async function getReturnRateMonth(month: string): Promise<ReturnRateMonth> {
  const { from, to } = monthRange(month);
  const lag = RETURN_LAG_DAYS * DAY_MS;
  const { out, returned } = await unitsByItem(from, to, new Date(from.getTime() + lag), new Date(to.getTime() + lag));
  const rows = await buildRows(out, returned);
  return { month, closed: Date.now() >= to.getTime() + RETURN_CLOSE_DAYS * DAY_MS, ...rows };
}

// Meses automáticos ya empezados (desde octubre 2026), del más reciente al
// más viejo.
export async function getAutoReturnRateMonths(): Promise<ReturnRateMonth[]> {
  const months: string[] = [];
  const current = guayaquilMonthOf(new Date());
  let [y, m] = RETURN_RATE_AUTO_SINCE_MONTH.split("-").map(Number);
  for (;;) {
    const key = `${y}-${String(m).padStart(2, "0")}`;
    if (key > current) break;
    months.push(key);
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
  }
  const result = await Promise.all(months.map(getReturnRateMonth));
  return result.reverse();
}

// Tarjeta de Inicio (pedido del usuario 2026-10-01): los productos que más
// regresan en los últimos 30 días — solo los que salieron lo suficiente.
export async function getTopReturnProducts(limit = 5) {
  const recent = await getRecentReturnRate();
  const ranked = recent.byProduct.filter((p) => p.out >= HIGH_RETURN_MIN_OUT && p.pct !== null);
  return {
    rows: ranked.slice(0, limit),
    highCount: ranked.filter((p) => p.high).length,
    readyAt: recent.readyAt ? recent.readyAt.toISOString() : null,
  };
}
export type TopReturnProducts = Awaited<ReturnType<typeof getTopReturnProducts>>;

// En tiempo real, por producto: lo que regresó en los últimos 30 días contra
// lo que salió en los 30 días que terminan hace RETURN_LAG_DAYS — para
// detectar rápido un producto que está regresando mucho. Nunca mira antes del
// primer corte: lo que regresa de ventas anteriores no tiene con qué
// compararse. readyAt = desde cuándo hay datos para mostrar.
export async function getRecentReturnRate() {
  const now = Date.now();
  const lag = RETURN_LAG_DAYS * DAY_MS;
  const span = 30 * DAY_MS;
  const first = await prisma.fulfillmentRequestBatch.findFirst({ orderBy: { requestedAt: "asc" }, select: { requestedAt: true } });
  const outFrom = Math.max(now - lag - span, first?.requestedAt.getTime() ?? now);
  const outTo = now - lag;
  const readyAt = new Date(outFrom + lag);
  if (outFrom >= outTo) return { ...(await buildRows(new Map(), new Map())), readyAt };
  const { out, returned } = await unitsByItem(new Date(outFrom), new Date(outTo), new Date(outFrom + lag), new Date(now));
  return { ...(await buildRows(out, returned)), readyAt: null };
}
