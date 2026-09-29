import { prisma } from "@/lib/prisma";
import { getFinanceLeadId, getFulfilmentLeadId, getInventoryLeadId, getSupplierStockoutResolverIds } from "@/lib/guards";
import { ecuadorDay } from "@/lib/fulfillmentGuides";
import { notifyOwner } from "@/lib/notifications";
import { formatPurchaseRequestCode, openPurchaseWhere } from "@/lib/purchases";
import { COLD_MAX, HOT_MAX, getHotBuyerIds } from "@/lib/purchaseSuggestions";

// "Producto que despierta" — pedido de Daniel, regla aprobada por él y por el
// usuario 2026-09-29. Un producto que salió 10 o menos en los 30 días
// anteriores y un día sale 4 o más: se avisa ese mismo día. Un solo día alto
// ya le interesa a Daniel (no tiene que mantenerse). Mientras el aviso está
// activo (7 días) no se vuelve a avisar del mismo producto: la tarjeta
// muestra lo que va saliendo. Ventas = manifiestos que sube Yair (combos ya
// separados por receta), contadas el día en que se subieron.
export const BASELINE_DAYS = 30;
export const BASELINE_MAX = 10;
export const SPIKE_MIN = 4;
export const ACTIVE_DAYS = 7;
// Los manifiestos se guardan desde el 21 de septiembre: antes de tener un mes
// entero de datos, casi todo lo que se vende parecería "nuevo" y llegarían
// avisos falsos. Acordado con el usuario: empieza solo el 26 de octubre.
export const SUDDEN_DEMAND_START_DAY = "2026-10-26";
export const SUDDEN_DEMAND_HREF = "/area/productos-que-despiertan";
export const SUDDEN_DEMAND_PENDING_TYPE = "productos_que_despiertan";
const NOTE_MAX = 500;

export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// 00:00 de ese día en Ecuador (UTC-5, sin horario de verano).
function dayStart(day: string): Date {
  return new Date(`${day}T05:00:00Z`);
}

function daysBetween(from: string, to: string): number {
  return Math.round((dayStart(to).getTime() - dayStart(from).getTime()) / (24 * 60 * 60 * 1000));
}

// Unidades por producto y por día desde `fromDay`. Una garantía de solo una
// pieza sale del stock de repuestos, no cuenta (mismo criterio que Qué comprar).
async function salesByItemDay(fromDay: string, catalogItemIds?: string[]): Promise<Map<string, Map<string, number>>> {
  const rows = await prisma.fulfillmentRequestItem.findMany({
    where: {
      ...(catalogItemIds ? { catalogItemId: { in: catalogItemIds } } : {}),
      batch: { requestedAt: { gte: dayStart(fromDay) } },
      OR: [{ warrantyMode: null }, { warrantyMode: { not: "PIECE" } }],
    },
    select: { catalogItemId: true, quantity: true, batch: { select: { requestedAt: true } } },
  });
  const out = new Map<string, Map<string, number>>();
  for (const r of rows) {
    const day = ecuadorDay(r.batch.requestedAt);
    let byDay = out.get(r.catalogItemId);
    if (!byDay) out.set(r.catalogItemId, (byDay = new Map()));
    byDay.set(day, (byDay.get(day) ?? 0) + r.quantity);
  }
  return out;
}

async function currentStock(catalogItemIds: string[]): Promise<Map<string, number>> {
  if (catalogItemIds.length === 0) return new Map();
  const rows = await prisma.stockKardexEntry.findMany({
    where: { catalogItemId: { in: catalogItemIds } },
    distinct: ["catalogItemId"],
    orderBy: [{ catalogItemId: "asc" }, { occurredAt: "desc" }, { createdAt: "desc" }],
    select: { catalogItemId: true, balanceAfter: true },
  });
  return new Map(rows.map((r) => [r.catalogItemId, r.balanceAfter]));
}

// Daniel, Jariel, Bryan Rios, Heidy y Yair (la lista de Daniel). Nairoby
// aparte: solo si el producto tiene 31 a 60 en bodega (pedido de Daniel).
export async function getSuddenDemandBaseAudienceIds(): Promise<string[]> {
  const [inventoryLeadId, fulfilmentLeadId, hotIds, mktIds] = await Promise.all([
    getInventoryLeadId(),
    getFulfilmentLeadId(),
    getHotBuyerIds(),
    getSupplierStockoutResolverIds(),
  ]);
  const ids = new Set<string>([...hotIds, ...mktIds]);
  if (inventoryLeadId) ids.add(inventoryLeadId);
  if (fulfilmentLeadId) ids.add(fulfilmentLeadId);
  return [...ids];
}

function inColdRange(stock: number) {
  return stock > HOT_MAX && stock <= COLD_MAX;
}

export async function canViewSuddenDemand(userId: string): Promise<boolean> {
  const [base, financeLeadId] = await Promise.all([getSuddenDemandBaseAudienceIds(), getFinanceLeadId()]);
  return base.includes(userId) || financeLeadId === userId;
}

// Solo Jariel (quien compra) escribe la nota; el admin también puede.
export async function canWriteSuddenDemandNote(userId: string | null, isAdmin: boolean): Promise<boolean> {
  if (isAdmin) return true;
  if (!userId) return false;
  return (await getHotBuyerIds()).includes(userId);
}

function fmtDayShort(day: string): string {
  return dayStart(day).toLocaleDateString("es-EC", { day: "numeric", month: "short", timeZone: "America/Guayaquil" });
}

// ---- Detección ------------------------------------------------------------

// Corre cuando Yair sube un manifiesto y en el cron diario (por si algo se
// escapó). Revisa ayer y hoy. Devuelve cuántos avisos nuevos creó.
export async function detectSuddenDemand(now: Date = new Date()): Promise<number> {
  const today = ecuadorDay(now);
  if (today < SUDDEN_DEMAND_START_DAY) return 0;
  const checkDays = [addDays(today, -1), today].filter((d) => d >= SUDDEN_DEMAND_START_DAY);
  const sales = await salesByItemDay(addDays(checkDays[0], -BASELINE_DAYS));

  const candidates: { catalogItemId: string; day: string; units: number; baseline: number }[] = [];
  for (const [catalogItemId, byDay] of sales) {
    for (const day of checkDays) {
      const units = byDay.get(day) ?? 0;
      if (units < SPIKE_MIN) continue;
      let baseline = 0;
      for (let i = 1; i <= BASELINE_DAYS; i++) baseline += byDay.get(addDays(day, -i)) ?? 0;
      if (baseline > BASELINE_MAX) continue;
      candidates.push({ catalogItemId, day, units, baseline });
    }
  }
  if (candidates.length === 0) return 0;

  const ids = [...new Set(candidates.map((c) => c.catalogItemId))];
  const [recent, stock, items] = await Promise.all([
    prisma.suddenDemandAlert.findMany({
      where: { catalogItemId: { in: ids }, day: { gte: addDays(checkDays[0], -(ACTIVE_DAYS - 1)) } },
      select: { catalogItemId: true },
    }),
    currentStock(ids),
    prisma.purchaseCatalogItem.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }),
  ]);
  const alreadyActive = new Set(recent.map((r) => r.catalogItemId));
  const nameById = new Map(items.map((i) => [i.id, i.name]));

  let created = 0;
  const [baseIds, financeLeadId] = await Promise.all([getSuddenDemandBaseAudienceIds(), getFinanceLeadId()]);
  for (const c of candidates.sort((a, b) => a.day.localeCompare(b.day))) {
    if (alreadyActive.has(c.catalogItemId)) continue;
    alreadyActive.add(c.catalogItemId);
    const stockNow = stock.get(c.catalogItemId) ?? 0;
    try {
      await prisma.suddenDemandAlert.create({
        data: { catalogItemId: c.catalogItemId, day: c.day, baselineUnits: c.baseline, dayUnits: c.units, stockAtAlert: stockNow },
      });
    } catch {
      // Otra corrida (subida de Yair + cron al mismo tiempo) ya lo creó.
      continue;
    }
    created++;
    const recipients = new Set(baseIds);
    if (financeLeadId && inColdRange(stockNow)) recipients.add(financeLeadId);
    const when = c.day === today ? "hoy" : `el ${fmtDayShort(c.day)}`;
    const body = `${nameById.get(c.catalogItemId) ?? "Un producto"}: salieron ${c.units} ${when} (antes ${c.baseline} en todo el mes). Quedan ${Math.max(0, stockNow)} en bodega.`;
    await Promise.all(
      [...recipients].map((id) => notifyOwner(id, { title: "📈 Producto que despierta", body, url: SUDDEN_DEMAND_HREF }).catch(() => null))
    );
  }
  return created;
}

// ---- Vista ----------------------------------------------------------------

export type SuddenDemandCard = {
  id: string;
  catalogItemId: string;
  name: string;
  justCode: string | null;
  photo: string | null;
  day: string;
  active: boolean;
  baselineUnits: number;
  dayUnits: number;
  // Lo que salió desde el día del salto (incluido), día por día.
  since: { day: string; units: number }[];
  sinceTotal: number;
  stock: number;
  daysLeft: number | null;
  openPurchase: { code: string | null; quantity: number } | null;
  // Devoluciones (Reingreso de Mercadería) de los últimos 30 días.
  returns: { good: number; damaged: number };
  note: string | null;
  noteByName: string | null;
  noteAt: string | null;
};

export async function getSuddenDemandCards(opts: { historyDays?: number } = {}): Promise<{ today: string; cards: SuddenDemandCard[] }> {
  const today = ecuadorDay(new Date());
  const activeFrom = addDays(today, -(ACTIVE_DAYS - 1));
  const from = opts.historyDays ? addDays(today, -opts.historyDays) : activeFrom;
  const alerts = await prisma.suddenDemandAlert.findMany({
    where: { day: { gte: from } },
    orderBy: [{ day: "desc" }, { createdAt: "desc" }],
    include: { catalogItem: { select: { name: true, justCode: true, photos: true } } },
  });
  if (alerts.length === 0) return { today, cards: [] };

  const ids = [...new Set(alerts.map((a) => a.catalogItemId))];
  const oldestDay = alerts.reduce((m, a) => (a.day < m ? a.day : m), today);
  const [sales, stock, openPurchases, reentries] = await Promise.all([
    salesByItemDay(oldestDay, ids),
    currentStock(ids),
    prisma.purchaseRequest.findMany({
      where: { catalogItemId: { in: ids }, ...openPurchaseWhere() },
      select: { catalogItemId: true, requestNumber: true, quantity: true },
      orderBy: { createdAt: "desc" },
    }),
    prisma.merchandiseReentryItem.findMany({
      where: { catalogItemId: { in: ids }, batch: { submittedAt: { gte: dayStart(addDays(today, -30)) } } },
      select: { catalogItemId: true, goodQty: true, damagedQty: true },
    }),
  ]);
  const openByItem = new Map<string, { code: string | null; quantity: number }>();
  for (const p of openPurchases) {
    const cur = openByItem.get(p.catalogItemId);
    if (cur) cur.quantity += p.quantity;
    else openByItem.set(p.catalogItemId, { code: p.requestNumber ? formatPurchaseRequestCode(p.requestNumber) : null, quantity: p.quantity });
  }
  const returnsByItem = new Map<string, { good: number; damaged: number }>();
  for (const r of reentries) {
    if (!r.catalogItemId) continue;
    const cur = returnsByItem.get(r.catalogItemId) ?? { good: 0, damaged: 0 };
    cur.good += r.goodQty;
    cur.damaged += r.damagedQty;
    returnsByItem.set(r.catalogItemId, cur);
  }

  const cards = alerts.map((a): SuddenDemandCard => {
    const byDay = sales.get(a.catalogItemId) ?? new Map<string, number>();
    const since: { day: string; units: number }[] = [];
    for (let d = a.day; d <= today; d = addDays(d, 1)) {
      const units = byDay.get(d) ?? 0;
      if (units > 0 || d === a.day) since.push({ day: d, units: d === a.day ? Math.max(units, a.dayUnits) : units });
    }
    const sinceTotal = since.reduce((s, x) => s + x.units, 0);
    const stockNow = stock.get(a.catalogItemId) ?? 0;
    const perDay = sinceTotal / (daysBetween(a.day, today) + 1);
    return {
      id: a.id,
      catalogItemId: a.catalogItemId,
      name: a.catalogItem.name,
      justCode: a.catalogItem.justCode,
      photo: a.catalogItem.photos[0] ?? null,
      day: a.day,
      active: a.day >= activeFrom,
      baselineUnits: a.baselineUnits,
      dayUnits: a.dayUnits,
      since,
      sinceTotal,
      stock: stockNow,
      daysLeft: perDay > 0 ? Math.max(0, stockNow) / perDay : null,
      openPurchase: openByItem.get(a.catalogItemId) ?? null,
      returns: returnsByItem.get(a.catalogItemId) ?? { good: 0, damaged: 0 },
      note: a.note,
      noteByName: a.noteByName,
      noteAt: a.noteAt?.toISOString() ?? null,
    };
  });
  return { today, cards };
}

export async function saveSuddenDemandNote(params: { alertId: string; note: string; userId: string | null; userName: string }): Promise<{ ok: true } | { ok: false; error: string }> {
  const text = params.note.trim().slice(0, NOTE_MAX);
  const alert = await prisma.suddenDemandAlert.findUnique({ where: { id: params.alertId }, select: { id: true } });
  if (!alert) return { ok: false, error: "No se encontró este aviso." };
  await prisma.suddenDemandAlert.update({
    where: { id: params.alertId },
    data: text
      ? { note: text, noteById: params.userId, noteByName: params.userName, noteAt: new Date() }
      : { note: null, noteById: null, noteByName: null, noteAt: null },
  });
  return { ok: true };
}

// ---- Inicio ---------------------------------------------------------------

export async function getSuddenDemandPendingItems(userId: string) {
  const [baseIds, financeLeadId, hotIds] = await Promise.all([getSuddenDemandBaseAudienceIds(), getFinanceLeadId(), getHotBuyerIds()]);
  const isBase = baseIds.includes(userId);
  const isFinance = financeLeadId === userId;
  if (!isBase && !isFinance) return [];

  const today = ecuadorDay(new Date());
  let active = await prisma.suddenDemandAlert.findMany({
    where: { day: { gte: addDays(today, -(ACTIVE_DAYS - 1)) } },
    select: { catalogItemId: true, note: true, catalogItem: { select: { name: true } } },
  });
  if (!isBase) {
    const stock = await currentStock(active.map((a) => a.catalogItemId));
    active = active.filter((a) => inColdRange(stock.get(a.catalogItemId) ?? 0));
  }
  if (active.length === 0) return [];

  const noNote = active.filter((a) => !a.note).length;
  const writesNote = hotIds.includes(userId);
  const names = active.slice(0, 2).map((a) => a.catalogItem.name).join(", ") + (active.length > 2 ? ` y ${active.length - 2} más` : "");
  const noteText = noNote === 0 ? "con nota de Jariel" : writesNote ? `${noNote} sin tu nota` : `${noNote} sin nota de Jariel`;
  return [
    {
      type: SUDDEN_DEMAND_PENDING_TYPE,
      icon: "📈",
      label: active.length === 1 ? "Producto que despierta" : "Productos que despiertan",
      meta: `${names} · ${noteText}`,
      overdue: writesNote && noNote > 0,
      href: SUDDEN_DEMAND_HREF,
    },
  ];
}
