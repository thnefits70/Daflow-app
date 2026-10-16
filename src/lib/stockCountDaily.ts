import { prisma } from "@/lib/prisma";

// Conteo diario por importancia — aprobado por el usuario 2026-10-16, reemplaza
// al conteo semanal de un área completa (2–5 horas seguidas un día):
// - Lunes a sábado, ~DAILY_TARGET productos (unos 25 minutos).
// - Cada producto se cuenta según cuánto se vende: mucho (≥30 u. en 30 días)
//   cada 4 semanas, poco cada 8, nada cada 3 meses.
// - Entran solos, antes que el resto: los que quedaron en negativo, los que
//   faltaron en un corte (se sacó menos de lo que pedían las guías) y los que
//   se acaban en una semana o menos y llevan 2+ semanas sin contarse (los que
//   se van a comprar).
// Se guarda como StockCount WEEKLY_AREA con area = DAILY y weekStart = el día
// (sin cambiar la base). La lista se calcula solo con lo que había ANTES de
// que empezara el conteo del día, así no cambia mientras se cuenta.

export const DAILY_AREA = "DAILY";
export const DAILY_TARGET = 10;
// Con muchos urgentes el día puede pasarse un poco, nunca más de esto.
const DAILY_MAX = 15;
const HIGH_SALES_30D = 30;
const INTERVAL_DAYS = { high: 28, low: 56, none: 91 } as const;
// Un urgente que ya se contó hace muy poco no vuelve a entrar enseguida.
const PRIORITY_MIN_GAP_DAYS = 3;
const LOW_STOCK_DAYS = 7;
const LOW_STOCK_RECOUNT_DAYS = 14;
const SHORTAGE_LOOKBACK_DAYS = 7;
// Para no amontonar todo el mismo día, se adelanta lo que ya va por la mitad de su plazo.
const EARLY_RATIO = 0.5;
const DAY_MS = 86_400_000;

export function isDailyCount(count: { kind: string; area: string | null }): boolean {
  return count.kind === "WEEKLY_AREA" && count.area === DAILY_AREA;
}

export type DailyReason = "negativo" | "falto_en_corte" | "se_acaba" | "toca";

type Row = { id: string; balance: number; moved: number; lastCounted: Date | null; shortage: boolean };

async function rowsAsOf(asOf: Date, excludeCountId: string): Promise<Row[]> {
  const since30 = new Date(asOf.getTime() - 30 * DAY_MS);
  const sinceShort = new Date(asOf.getTime() - SHORTAGE_LOOKBACK_DAYS * DAY_MS);
  const rows = await prisma.$queryRaw<{ id: string; balance: number; moved: number; last_counted: Date | null; shortage: boolean }[]>`
    with bal as (
      select distinct on (e."catalogItemId") e."catalogItemId" id, e."balanceAfter" balance
      from "StockKardexEntry" e
      where e."occurredAt" < ${asOf} and e."createdAt" < ${asOf}
      order by e."catalogItemId", e."occurredAt" desc, e."createdAt" desc
    ),
    mov as (
      select "catalogItemId" id, sum(abs(quantity))::int moved
      from "StockKardexEntry"
      where type = 'OUT' and "occurredAt" >= ${since30} and "occurredAt" < ${asOf} and "createdAt" < ${asOf}
      group by 1
    ),
    counted as (
      select id, max(at) at from (
        select l."catalogItemId" id, l."countedAt" at from "StockCountLine" l
        where l."countId" <> ${excludeCountId} and l."countedAt" < ${asOf}
        union all
        select e."catalogItemId", e."occurredAt" from "StockKardexEntry" e
        where e.type = 'PHYSICAL_COUNT_ADJUSTMENT' and e."occurredAt" < ${asOf}
      ) x group by id
    ),
    need as (
      select b."lotId", i."catalogItemId" id, sum(i.quantity) qty
      from "FulfillmentRequestItem" i join "FulfillmentRequestBatch" b on b.id = i."batchId"
      where b."lotId" is not null
      group by 1, 2
    ),
    short as (
      select distinct p."catalogItemId" id
      from "FulfillmentLotPick" p join need n on n."lotId" = p."lotId" and n.id = p."catalogItemId"
      where p."confirmedAt" >= ${sinceShort} and p."confirmedAt" < ${asOf} and p."confirmedQty" is not null and p."confirmedQty" < n.qty
    )
    select bal.id, bal.balance, coalesce(mov.moved, 0) moved, counted.at last_counted, (short.id is not null) shortage
    from bal
    left join mov on mov.id = bal.id
    left join counted on counted.id = bal.id
    left join short on short.id = bal.id`;
  return rows.map((r) => ({ id: r.id, balance: Number(r.balance), moved: Number(r.moved), lastCounted: r.last_counted, shortage: r.shortage }));
}

function intervalDays(moved: number): number {
  return moved >= HIGH_SALES_30D ? INTERVAL_DAYS.high : moved > 0 ? INTERVAL_DAYS.low : INTERVAL_DAYS.none;
}

// Lista del día: catalogItemId → por qué entra.
export async function selectDailyProducts(asOf: Date, excludeCountId: string): Promise<Map<string, DailyReason>> {
  const rows = await rowsAsOf(asOf, excludeCountId);
  const daysSince = (r: Row) => (r.lastCounted ? (asOf.getTime() - r.lastCounted.getTime()) / DAY_MS : Infinity);
  const priority: { r: Row; reason: DailyReason; rank: number }[] = [];
  const rest: { r: Row; ratio: number }[] = [];
  for (const r of rows) {
    const since = daysSince(r);
    const daysLeft = r.moved > 0 ? r.balance / (r.moved / 30) : Infinity;
    if (since >= PRIORITY_MIN_GAP_DAYS) {
      if (r.balance < 0) { priority.push({ r, reason: "negativo", rank: 0 }); continue; }
      if (r.shortage) { priority.push({ r, reason: "falto_en_corte", rank: 1 }); continue; }
      if (daysLeft <= LOW_STOCK_DAYS && since >= LOW_STOCK_RECOUNT_DAYS) { priority.push({ r, reason: "se_acaba", rank: 2 }); continue; }
    }
    const ratio = since / intervalDays(r.moved);
    if (ratio >= EARLY_RATIO) rest.push({ r, ratio });
  }
  priority.sort((a, b) => a.rank - b.rank || b.r.moved - a.r.moved);
  rest.sort((a, b) => b.ratio - a.ratio || b.r.moved - a.r.moved);
  const out = new Map<string, DailyReason>();
  for (const p of priority.slice(0, DAILY_MAX)) out.set(p.r.id, p.reason);
  for (const x of rest) {
    if (out.size >= DAILY_TARGET) break;
    out.set(x.r.id, "toca");
  }
  return out;
}

// La lista no cambia en el día: se guarda en memoria por conteo.
const cache = new Map<string, { at: number; ids: Map<string, DailyReason> }>();

export async function dailySelection(count: { id: string; startedAt: Date }): Promise<Map<string, DailyReason>> {
  const hit = cache.get(count.id);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.ids;
  const ids = await selectDailyProducts(count.startedAt, count.id);
  cache.set(count.id, { at: Date.now(), ids });
  return ids;
}

// Productos del conteo del día: la lista + lo que ya tiene línea en él
// (recuentos que pasaron de días anteriores o algo que Daniel contó aparte).
// Lo que está en recuento lo cuenta otra persona: no entra en la tarea del
// día salvo withRecounts (la pantalla, para que quien recuenta lo vea).
export async function dailyProductIds(countId: string, withRecounts = false): Promise<string[]> {
  const count = await prisma.stockCount.findUnique({ where: { id: countId }, select: { id: true, startedAt: true } });
  if (!count) return [];
  const [sel, lines] = await Promise.all([dailySelection(count), prisma.stockCountLine.findMany({ where: { countId, ...(withRecounts ? {} : { OR: [{ decision: null }, { decision: { not: "RECOUNT" } }] }) }, select: { catalogItemId: true } })]);
  return [...new Set([...sel.keys(), ...lines.map((l) => l.catalogItemId)])];
}

export const DAILY_REASON_TEXT: Record<DailyReason, string> = {
  negativo: "Quedó en negativo",
  falto_en_corte: "Faltó en un corte",
  se_acaba: "Se acaba pronto",
  toca: "Le toca",
};
