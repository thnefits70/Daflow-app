import { prisma } from "@/lib/prisma";
import { getInventoryLeadId } from "@/lib/guards";
import { countedBalance, findUncountedItems, getCountGate, getCountMarks, isUncounted, type CountMark } from "@/lib/countGate";
import { formatPurchaseRequestCode, OPEN_PURCHASE_STATUSES, openPurchaseWhere } from "@/lib/purchases";
import { getReadyToBuyPendingProposalIdsByBuyer } from "@/lib/marketProduct";
import { notifyOwner } from "@/lib/notifications";
import { isWithinBusinessHours } from "@/lib/businessHours";
import { getVariantSales, MIX_MIN_UNITS } from "@/lib/variantSales";

// Confirmado 2026-09-29, idea de Daniel aprobada por el usuario: "Qué
// comprar". Compras calientes (30 o menos, más los productos nuevos que
// nunca entraron a bodega) → Jariel; compras frías (31 a 60) → Nairoby. Las
// cantidades son iguales para todos los productos (decisión del usuario).
// Dentro de cada lista manda lo que de verdad se vende: un producto con poco
// stock que no sale no es prioridad (ejemplo de Daniel). Si un urgente pasa
// 3 días sin comprarse, se avisa a Daniel. Todo se calcula al leer, sin
// guardar nada en la base.
//
// Cambio 2026-10-13 (pedido de Jariel, reglas elegidas por el usuario): la
// compra caliente ya no es "30 o menos". Se sigue CADA producto de la bodega:
// con la venta diaria promedio de los últimos 10 días (pedidos de Dropi +
// ventas externas) se pronostica en cuántos días se acaba, y lo que se acaba
// en 3 días o menos es compra caliente (Jariel), tenga el stock que tenga.
// Lo demás con 60 o menos va a compras frías (Nairoby) hasta que le queden
// 3 días. A Jariel le llega el aviso TODOS los días con todas las calientes
// sin gestionar, marcando las nuevas de ese día.
export const HOT_DAYS = 3;
export const HOT_SALES_WINDOW_DAYS = 10;
// Recompras sigue usando "30 o menos" para decidir si pide calculadora.
export const HOT_MAX = 30;
export const COLD_MAX = 60;
// "Urgente" y la cantidad sugerida usan lo que de verdad tarda en llegar la
// mercadería. Corregido por el usuario 2026-10-14: los 15/7 días que dio
// Daniel el 2026-10-01 eran solo el plazo para revisar la mercadería y
// reclamarle a CHEN, no lo que tarda. CHEN la trae en máximo 2 días; los demás
// proveedores, en máximo 4 días hábiles (lunes a sábado medio día) ≈ 5 días
// de calendario contando el domingo. El proveedor es el de la última compra
// del producto; sin compra en DAFLOW, el de los demás.
export const URGENT_DAYS = 5;
export const URGENT_DAYS_CREDIT_SUPPLIER = 2;
// Confirmado 2026-10-01 por Daniel: sugerir cuánto comprar — lo que se vende
// mientras llega + un mes más después de que llegue, menos lo que hay.
export const COVER_DAYS_AFTER_ARRIVAL = 30;
export const ESCALATE_DAYS = 3;
// Pedido de Jariel 2026-10-01 (vía el usuario): lo que él marcó con
// "Ningún proveedor lo tiene" ya no le sale todos los días (le estresaba).
// Cada 15 días se le pregunta si el proveedor ya lo tiene: "Todavía no le
// llega" lo esconde otros 15 días, "Ya lo tiene" lo devuelve a la lista
// normal. Tampoco se escala a Daniel: no hay nada que comprar. Una compra
// nueva del producto también lo devuelve a lo normal.
export const SUPPLIER_RECHECK_DAYS = 15;
// Pedido del usuario 2026-10-02 (compras frías, Nairoby): comprar bien lleva
// análisis, así que su lista es semanal — aviso solo los lunes, tarjeta en
// Inicio toda la semana con lo que hay que comprar o descartar ESA semana
// (urgente, o se vuelve urgente en los próximos 7 días). Si un urgente de su
// lista pasa 7 días sin comprarse ni descartarse, se avisa a Daniel. Puede
// decir "No hace falta comprarlo" con motivo y doble confirmación (le llega
// al líder de Análisis de Mercado y al admin); el descarte vale 30 días, o
// hasta que un producto que era "pronto" se ponga urgente.
export const COLD_ESCALATE_DAYS = 7;
// Pedido del usuario 2026-10-02: conteo físico de lunes 5 a jueves 8 de
// octubre. Hasta que termine el stock no es confiable, así que "Qué comprar"
// no manda avisos ni sale en Inicio (la pestaña sigue visible, con aviso).
// Vuelve solo el viernes 9 a las 8:00.
export const PHYSICAL_COUNT_UNTIL = new Date("2026-10-09T08:00:00-05:00");
export function isPhysicalCountPause(now = new Date()): boolean {
  return now < PHYSICAL_COUNT_UNTIL;
}
export const COLD_WEEK_AHEAD_DAYS = 7;
// Pedido de Jariel 2026-10-14 (aprobado por el usuario: lista semanal igual +
// aviso diario): a quien hace las compras frías le llega TODOS los días lo
// que se acaba en 4 o 5 días (justo antes de volverse compra caliente), con
// cualquier stock — también lo que tiene más de 60 pero se vende mucho.
export const COLD_SOON_DAYS = 5;
export const DISCARD_VALID_DAYS = 30;
export const DISCARD_REASONS: Record<string, string> = {
  NO_DEMAND: "No hay demanda del producto",
  NO_SALES: "El producto ya no tiene ventas",
  // Pedido del usuario 2026-10-06: sale de la calculadora de Recompras.
  COMPETITOR_CHEAPER: "La competencia lo tiene más barato",
  OTHER: "Otro motivo",
};
const WINDOW_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

// Solicitud de compra todavía en camino — definido en purchases.ts.
export { OPEN_PURCHASE_STATUSES };

// preguntar_proveedor = toca preguntar si el proveedor ya lo tiene;
// sin_proveedor = marcado sin proveedor, esperando los 15 días.
// descartado = Nairoby dijo "No hace falta comprarlo" (solo compras frías).
export type SuggestionStatus = "preguntar_proveedor" | "urgente" | "pronto" | "sin_proveedor" | "descartado" | "no_sale" | "en_compra" | "falta_contar";

export type DiscardInfo = { id: string; reason: string; reasonLabel: string; note: string | null; byName: string | null; at: string };

export type SuggestionRow = {
  catalogItemId: string;
  name: string;
  justCode: string | null;
  photo: string | null;
  stock: number;
  sold: number;
  perDay: number;
  daysLeft: number | null;
  status: SuggestionStatus;
  openPurchase: { code: string | null; quantity: number } | null;
  // Urgente desde hace 3 días o más sin que nadie lo compre (ya se avisó a Daniel).
  escalated: boolean;
  // Proveedor de la última compra y con cuántos días de anticipación se vuelve urgente.
  supplierName: string | null;
  urgentDays: number;
  // Cuánto conviene comprar (null si no se vende o ya está en compra).
  suggestedQty: number | null;
  // Marca "Ningún proveedor lo tiene" vigente: cuándo se marcó y cuándo se vuelve a preguntar.
  supplierOut: { reportId: string; since: string; askAt: string } | null;
  // Compras frías: hay que comprarlo o descartarlo esta semana.
  thisWeek: boolean;
  // Descarte vigente, o el último que ya dejó de valer (y por qué volvió).
  discard: DiscardInfo | null;
  discardReturned: (DiscardInfo & { why: "urgente" | "vencido" }) | null;
  // Colores/tallas que salieron en los últimos 30 días (2026-10-05), para
  // repartir lo que se compra. null si no tiene variantes o hay muy pocas.
  variants: { label: string; units: number }[] | null;
  // Conteo físico (2026-10-13): true = ya contado, false = falta contar,
  // null = no hay conteo general abierto. countedUrgent = falta contarlo y
  // según el sistema ya estaría urgente (Daniel lo cuenta primero).
  counted: boolean | null;
  countedUrgent: boolean;
  // Compra caliente que entró hoy a la lista (ayer alcanzaba para más de HOT_DAYS).
  newToday: boolean;
  // Franja de Stock Actual (2026-10-14, pedido de Jariel): verde = recontado,
  // stock real; amarillo = contado sin aplicar o en recuento; null = sin contar.
  countMark: CountMark | null;
  // "Pedir que lo cuenten" todavía abierto (2026-10-14).
  countRequest: CountRequest | null;
  // Compra fría que se acaba en COLD_SOON_DAYS o menos: aviso diario (2026-10-14).
  coldSoon: boolean;
};

export type NewProductRow = { proposalId: string; code: string; name: string; photo: string | null; readyToBuyAt: string };

export type PurchaseSuggestions = {
  windowDays: number;
  hot: SuggestionRow[];
  cold: SuggestionRow[];
  newProducts: NewProductRow[];
  // Pedido del usuario 2026-10-05: los productos nuevos que propuso Nairoby
  // los compra ella (compras frías); los demás, Jariel.
  coldNewProducts: NewProductRow[];
};

const STATUS_ORDER: Record<SuggestionStatus, number> = { preguntar_proveedor: 0, urgente: 1, pronto: 2, falta_contar: 3, sin_proveedor: 4, en_compra: 5, descartado: 6, no_sale: 7 };

function sortRows(rows: SuggestionRow[]): SuggestionRow[] {
  return rows.sort((a, b) => {
    const s = STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
    if (s !== 0) return s;
    if (a.daysLeft !== null && b.daysLeft !== null && a.daysLeft !== b.daysLeft) return a.daysLeft - b.daysLeft;
    if (a.perDay !== b.perDay) return b.perDay - a.perDay;
    return a.stock - b.stock;
  });
}

async function latestBalances(before?: Date): Promise<Map<string, number>> {
  const rows = await prisma.stockKardexEntry.findMany({
    where: before ? { occurredAt: { lte: before } } : undefined,
    distinct: ["catalogItemId"],
    orderBy: [{ catalogItemId: "asc" }, { occurredAt: "desc" }, { createdAt: "desc" }],
    select: { catalogItemId: true, balanceAfter: true },
  });
  return new Map(rows.map((r) => [r.catalogItemId, r.balanceAfter]));
}

// Ventas = pedidos de Dropi que sube Yair (combos ya separados en sus
// productos por la receta) + ventas externas. Una garantía de solo una
// pieza sale del stock de repuestos, no cuenta. Los pedidos existen desde
// 2026-09-21, así que al principio la ventana es más corta que 30 días.
// Compartido con Recompras (repurchaseReviews.ts) para que ambas pantallas
// muestren exactamente las mismas ventas.
export async function getSalesWindow(now = new Date(), days = WINDOW_DAYS): Promise<{ windowStart: Date; windowDays: number }> {
  const firstBatch = await prisma.fulfillmentRequestBatch.findFirst({ orderBy: { requestedAt: "asc" }, select: { requestedAt: true } });
  const windowStart = new Date(Math.max(now.getTime() - days * DAY_MS, firstBatch?.requestedAt.getTime() ?? now.getTime()));
  return { windowStart, windowDays: Math.max(1, (now.getTime() - windowStart.getTime()) / DAY_MS) };
}

export async function getSoldUnitsByItem(windowStart: Date, catalogItemIds?: string[]): Promise<Map<string, number>> {
  const only = catalogItemIds ? { catalogItemId: { in: catalogItemIds } } : {};
  const [dropiSales, externalSales] = await Promise.all([
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
  ]);
  const sold = new Map<string, number>();
  for (const r of [...dropiSales, ...externalSales]) {
    if (!r.catalogItemId) continue;
    sold.set(r.catalogItemId, (sold.get(r.catalogItemId) ?? 0) + (r._sum.quantity ?? 0));
  }
  return sold;
}

// Días de anticipación del proveedor y cantidad sugerida — mismas reglas de
// Daniel que usa la lista (ver URGENT_DAYS y COVER_DAYS_AFTER_ARRIVAL).
export function urgentDaysForSupplier(paymentMode: string | null | undefined): number {
  return paymentMode === "CREDITO" ? URGENT_DAYS_CREDIT_SUPPLIER : URGENT_DAYS;
}
export function suggestedQuantity(perDay: number, urgentDays: number, stock: number): number | null {
  const needed = Math.ceil(perDay * (urgentDays + COVER_DAYS_AFTER_ARRIVAL) - Math.max(0, stock));
  return needed > 0 ? needed : null;
}

// Pedido del usuario 2026-10-07 (luces navideñas SC-149/SC-162): si todavía
// hay stock, no se vuelve a comprar. "Alcanza" = no saldría en Qué comprar
// (más de COLD_MAX) y cubre lo que se vende mientras llega + 1 mes (no hay
// cantidad sugerida). Un producto sin ventas con más de COLD_MAX también
// alcanza. Durante el conteo físico el stock no es confiable: solo se avisa;
// después se bloquea (para comprar igual, motivo y aprobación de Bryan).
export function stockStillCovers(stock: number, perDay: number, urgentDays: number): boolean {
  return stock > COLD_MAX && suggestedQuantity(perDay, urgentDays, stock) === null;
}
export function isStockCoverBlockActive(now = new Date()): boolean {
  return !isPhysicalCountPause(now);
}
export function stockCoverMessage(itemName: string, stock: number, daysLeft: number | null): string {
  const lasts = daysLeft === null ? "y casi no se vende" : `y alcanzan para ${Math.floor(daysLeft)} días`;
  return `Todavía hay stock de "${itemName}": quedan ${stock} u. ${lasts}. No hace falta comprarlo todavía.`;
}

// Pedido del usuario 2026-10-13: en Solicitar (también la vía rápida de
// compras calientes) lo que todavía alcanza solo se pide con un motivo en la
// justificación de esa línea, que Bryan ve al aprobar. Devuelve el error o,
// si todo está bien, el motivo de cada línea frenada (índice → texto).
export const STOCK_COVER_REASON_MIN = 10;
export async function checkStockCoverReasons(items: { catalogItemId: string; justification?: string | null }[]): Promise<{ ok: true; reasons: Map<number, string> } | { ok: false; error: string }> {
  const reasons = new Map<number, string>();
  if (!isStockCoverBlockActive()) return { ok: true, reasons };
  const covered = await findItemsWithStockCover(items.map((it) => it.catalogItemId));
  for (const c of covered) {
    const idx = items.findIndex((it) => it.catalogItemId === c.catalogItemId);
    const why = items[idx]?.justification?.trim() ?? "";
    if (why.length < STOCK_COVER_REASON_MIN) return { ok: false, error: `${c.message} Si de verdad hace falta (ej. temporada, oferta del proveedor), explica el motivo en la justificación de ese producto para Bryan.` };
    reasons.set(idx, why);
  }
  return { ok: true, reasons };
}

// Mismo cálculo que la lista, para los productos de una solicitud de compra.
export async function findItemsWithStockCover(catalogItemIds: string[]): Promise<{ catalogItemId: string; message: string }[]> {
  const ids = [...new Set(catalogItemIds)];
  if (ids.length === 0) return [];
  const { windowStart, windowDays } = await getSalesWindow();
  const [balances, sold, lastPurchases, items] = await Promise.all([
    prisma.stockKardexEntry.findMany({
      where: { catalogItemId: { in: ids } },
      distinct: ["catalogItemId"],
      orderBy: [{ catalogItemId: "asc" }, { occurredAt: "desc" }, { createdAt: "desc" }],
      select: { catalogItemId: true, balanceAfter: true },
    }),
    getSoldUnitsByItem(windowStart, ids),
    prisma.purchaseRequest.findMany({
      where: { catalogItemId: { in: ids }, status: { not: "REJECTED" } },
      distinct: ["catalogItemId"],
      orderBy: [{ catalogItemId: "asc" }, { createdAt: "desc" }],
      select: { catalogItemId: true, supplier: { select: { paymentMode: true } } },
    }),
    prisma.purchaseCatalogItem.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, bodega: true, justCode: true } }),
  ]);
  const name = new Map(items.map((i) => [i.id, i.name]));
  // Los suministros (fundas, cintas…) no se venden: siempre "alcanzan", no se frenan.
  const supplies = new Set(items.filter((i) => i.bodega === "MKT_SUMINISTROS" || !!i.justCode?.includes("-SUM-")).map((i) => i.id));
  const mode = new Map(lastPurchases.map((p) => [p.catalogItemId, p.supplier.paymentMode]));
  // Con el conteo físico abierto, lo contado manda (2026-10-13).
  const gate = await getCountGate(ids);
  const out: { catalogItemId: string; message: string }[] = [];
  for (const b of balances) {
    if (supplies.has(b.catalogItemId)) continue;
    const stock = countedBalance(gate, b.catalogItemId, b.balanceAfter);
    const perDay = (sold.get(b.catalogItemId) ?? 0) / windowDays;
    if (!stockStillCovers(stock, perDay, urgentDaysForSupplier(mode.get(b.catalogItemId)))) continue;
    const daysLeft = perDay > 0 ? stock / perDay : null;
    out.push({ catalogItemId: b.catalogItemId, message: stockCoverMessage(name.get(b.catalogItemId) ?? "este producto", stock, daysLeft) });
  }
  return out;
}

// Pedido de Jariel 2026-10-14: en Solicitar, una cantidad sugerida (no
// obligatoria) con el mismo cálculo que Qué comprar — venta diaria promedio
// de los últimos HOT_SALES_WINDOW_DAYS días × (días del proveedor + 1 mes) −
// stock (contado si ya se contó). null = suministro, sin Kardex o no se vende.
// lastPurchase (Jariel 2026-10-14, idea de Bryan Ríos): la compra anterior, para comparar cuánto más o menos se pide.
export type QuantitySuggestion = { qty: number | null; perDay: number; stock: number; daysLeft: number; urgentDays: number; supplierName: string | null; windowDays: number; lastPurchase: { quantity: number; at: string } | null };
export async function getQuantitySuggestion(catalogItemId: string): Promise<QuantitySuggestion | null> {
  const item = await prisma.purchaseCatalogItem.findUnique({ where: { id: catalogItemId }, select: { bodega: true, justCode: true } });
  if (!item || item.bodega === "MKT_SUMINISTROS" || item.justCode?.includes("-SUM-")) return null;
  const { windowStart, windowDays } = await getSalesWindow(new Date(), HOT_SALES_WINDOW_DAYS);
  const [kardex, sold, last, gate] = await Promise.all([
    prisma.stockKardexEntry.findFirst({ where: { catalogItemId }, orderBy: [{ occurredAt: "desc" }, { createdAt: "desc" }], select: { balanceAfter: true } }),
    getSoldUnitsByItem(windowStart, [catalogItemId]),
    prisma.purchaseRequest.findFirst({ where: { catalogItemId, status: { not: "REJECTED" } }, orderBy: { createdAt: "desc" }, select: { quantity: true, createdAt: true, supplier: { select: { name: true, paymentMode: true } } } }),
    getCountGate([catalogItemId]),
  ]);
  if (!kardex) return null;
  const perDay = (sold.get(catalogItemId) ?? 0) / windowDays;
  if (perDay === 0) return null;
  const stock = countedBalance(gate, catalogItemId, kardex.balanceAfter);
  const urgentDays = urgentDaysForSupplier(last?.supplier.paymentMode);
  return { qty: suggestedQuantity(perDay, urgentDays, stock), perDay, stock, daysLeft: Math.max(0, stock) / perDay, urgentDays, supplierName: last?.supplier.name ?? null, windowDays: Math.round(windowDays), lastPurchase: last ? { quantity: last.quantity, at: last.createdAt.toISOString() } : null };
}

export async function getPurchaseSuggestions(): Promise<PurchaseSuggestions> {
  const now = new Date();
  const { windowStart, windowDays } = await getSalesWindow(now, HOT_SALES_WINDOW_DAYS);

  const [kardexBalances, kardexYesterday, kardexBefore, kardexBeforeCold, gate, sold, openPurchases, readyByBuyer] = await Promise.all([
    latestBalances(),
    latestBalances(new Date(now.getTime() - DAY_MS)),
    latestBalances(new Date(now.getTime() - ESCALATE_DAYS * DAY_MS)),
    latestBalances(new Date(now.getTime() - COLD_ESCALATE_DAYS * DAY_MS)),
    getCountGate(),
    getSoldUnitsByItem(windowStart),
    prisma.purchaseRequest.findMany({
      where: openPurchaseWhere(),
      select: { catalogItemId: true, requestNumber: true, quantity: true },
      orderBy: { createdAt: "desc" },
    }),
    getReadyToBuyPendingProposalIdsByBuyer(),
  ]);
  const readyIds = [...readyByBuyer.hot, ...readyByBuyer.cold];
  // Conteo físico abierto (2026-10-13): lo contado manda sobre el Kardex.
  const withCount = (m: Map<string, number>) => new Map([...m].map(([id, bal]) => [id, countedBalance(gate, id, bal)]));
  const balances = withCount(kardexBalances);
  const balancesYesterday = withCount(kardexYesterday);
  const balancesBefore = withCount(kardexBefore);
  const balancesBeforeCold = withCount(kardexBeforeCold);

  const openByItem = new Map<string, { code: string | null; quantity: number }>();
  for (const p of openPurchases) {
    const cur = openByItem.get(p.catalogItemId);
    if (cur) cur.quantity += p.quantity;
    else openByItem.set(p.catalogItemId, { code: p.requestNumber ? formatPurchaseRequestCode(p.requestNumber) : null, quantity: p.quantity });
  }

  // Solo productos que alguna vez estuvieron en INVESTOCK. Los que esperan
  // su ID de Dropi siguen el camino de productos nuevos (Análisis de Mercado).
  // Pedido del usuario 2026-10-02: un stock negativo es un error de conteo,
  // no una compra urgente — se sacan de la lista hasta que se corrija.
  // Compra caliente = se acaba en HOT_DAYS o menos, con cualquier stock.
  const perDayOf = (id: string) => (sold.get(id) ?? 0) / windowDays;
  const isHotStock = (id: string, bal: number) => perDayOf(id) > 0 && Math.max(0, bal) / perDayOf(id) <= HOT_DAYS;
  // Pedido de Jariel 2026-10-14 (Radio Baofeng 142 sin contar, Consola Retro
  // −11 en recuento): lo que falta contar y se vende entra a "Falta contar"
  // aunque el sistema diga que sobra o esté en negativo — el número no es real
  // y sin esto no había desde dónde pedir que lo cuenten.
  const uncountedSelling = (id: string, bal: number) =>
    gate.active && !gate.counted.has(id) && perDayOf(id) > 0 && (bal < 0 || bal / perDayOf(id) <= Math.max(URGENT_DAYS, URGENT_DAYS_CREDIT_SUPPLIER) + COLD_WEEK_AHEAD_DAYS);
  const isColdSoonStock = (id: string, bal: number) => perDayOf(id) > 0 && Math.max(0, bal) / perDayOf(id) <= COLD_SOON_DAYS;
  const candidateIds = [...balances.entries()].filter(([id, bal]) => (bal >= 0 && (bal <= COLD_MAX || isColdSoonStock(id, bal))) || uncountedSelling(id, bal)).map(([id]) => id);
  const [items, lastPurchases, stockoutReports, discards] = await Promise.all([
    prisma.purchaseCatalogItem.findMany({
      where: { id: { in: candidateIds }, awaitingDropiId: false },
      select: { id: true, name: true, photos: true, justCode: true, bodega: true },
    }),
    prisma.purchaseRequest.findMany({
      where: { catalogItemId: { in: candidateIds }, status: { not: "REJECTED" } },
      distinct: ["catalogItemId"],
      orderBy: [{ catalogItemId: "asc" }, { createdAt: "desc" }],
      select: { catalogItemId: true, createdAt: true, supplier: { select: { name: true, paymentMode: true } } },
    }),
    prisma.supplierStockoutReport.findMany({
      where: { catalogItemId: { in: candidateIds } },
      distinct: ["catalogItemId"],
      orderBy: [{ catalogItemId: "asc" }, { reportedAt: "desc" }],
      select: { id: true, catalogItemId: true, reportedAt: true, supplierCheckedAt: true, supplierBackAt: true },
    }),
    prisma.purchaseSuggestionDiscard.findMany({
      where: { catalogItemId: { in: candidateIds }, undoneAt: null, discardedAt: { gte: new Date(now.getTime() - 2 * DISCARD_VALID_DAYS * DAY_MS) } },
      distinct: ["catalogItemId"],
      orderBy: [{ catalogItemId: "asc" }, { discardedAt: "desc" }],
      select: { id: true, catalogItemId: true, reason: true, note: true, statusAtDiscard: true, discardedAt: true, discardedBy: { select: { name: true } } },
    }),
  ]);
  const discardByItem = new Map(discards.map((d) => [d.catalogItemId, d]));
  const supplierByItem = new Map(lastPurchases.map((p) => [p.catalogItemId, p.supplier]));
  const lastPurchaseAt = new Map(lastPurchases.map((p) => [p.catalogItemId, p.createdAt]));
  // La marca sigue vigente mientras no diga "Ya lo tiene" ni haya una compra posterior.
  const supplierOutByItem = new Map<string, { reportId: string; since: Date; askAt: Date }>();
  for (const r of stockoutReports) {
    const bought = lastPurchaseAt.get(r.catalogItemId);
    if (r.supplierBackAt || (bought && bought > r.reportedAt)) continue;
    const askAt = new Date((r.supplierCheckedAt ?? r.reportedAt).getTime() + SUPPLIER_RECHECK_DAYS * DAY_MS);
    supplierOutByItem.set(r.catalogItemId, { reportId: r.id, since: r.reportedAt, askAt });
  }

  const hot: SuggestionRow[] = [];
  const cold: SuggestionRow[] = [];
  for (const item of items) {
    const stock = balances.get(item.id) ?? 0;
    const units = sold.get(item.id) ?? 0;
    const perDay = units / windowDays;
    const daysLeft = perDay > 0 ? Math.max(0, stock) / perDay : null;
    const openPurchase = openByItem.get(item.id) ?? null;
    const supplier = supplierByItem.get(item.id) ?? null;
    const urgentDays = urgentDaysForSupplier(supplier?.paymentMode);
    const supplierOut = supplierOutByItem.get(item.id) ?? null;
    const isHot = isHotStock(item.id, stock);
    const isCold = !isHot;
    // CHEN lo trae en 1 día (2026-10-14): igual, todo lo que ya se acaba en
    // HOT_DAYS es compra caliente y cuenta como urgente.
    const urgentLimit = Math.max(urgentDays, HOT_DAYS);
    const baseStatus: SuggestionStatus = openPurchase
      ? "en_compra"
      : perDay === 0
        ? "no_sale"
        : supplierOut
          ? supplierOut.askAt <= now
            ? "preguntar_proveedor"
            : "sin_proveedor"
          : daysLeft! <= urgentLimit
            ? "urgente"
            : "pronto";
    // Descarte de Nairoby: solo en compras frías y solo sobre urgente/pronto.
    const d = discardByItem.get(item.id);
    let discard: DiscardInfo | null = null;
    let discardReturned: SuggestionRow["discardReturned"] = null;
    if (d && isCold) {
      const info: DiscardInfo = {
        id: d.id,
        reason: d.reason,
        reasonLabel: DISCARD_REASONS[d.reason] ?? d.reason,
        note: d.note,
        byName: d.discardedBy?.name ?? null,
        at: d.discardedAt.toISOString(),
      };
      const expired = now.getTime() - d.discardedAt.getTime() > DISCARD_VALID_DAYS * DAY_MS;
      const turnedUrgent = d.statusAtDiscard === "pronto" && baseStatus === "urgente";
      if (!expired && !turnedUrgent) discard = info;
      else if (baseStatus === "urgente" || baseStatus === "pronto") discardReturned = { ...info, why: turnedUrgent ? "urgente" : "vencido" };
    }
    // Pedido del usuario 2026-10-13: sin contar no se sabe cuánto hay de
    // verdad — no se sugiere cantidad ni se puede comprar (salvo emergencia).
    const isSupply = item.bodega === "MKT_SUMINISTROS" || !!item.justCode?.includes("-SUM-");
    const uncounted = !isSupply && isUncounted(gate, item.id, true);
    const status: SuggestionStatus =
      uncounted && (baseStatus === "urgente" || baseStatus === "pronto") ? "falta_contar" : discard && (baseStatus === "urgente" || baseStatus === "pronto") ? "descartado" : baseStatus;
    // Ya era urgente hace 3 días (7 en compras frías) con el stock de ese día y
    // la venta de hoy. En calientes, "urgente" = ya se acababa en HOT_DAYS.
    const before = (isCold ? balancesBeforeCold : balancesBefore).get(item.id);
    const escalated = status === "urgente" && before !== undefined && Math.max(0, before) / perDay <= (isHot ? HOT_DAYS : urgentDays);
    // Caliente nueva de hoy: ayer todavía alcanzaba para más de HOT_DAYS.
    const yesterday = balancesYesterday.get(item.id);
    const newToday = isHot && (yesterday === undefined || !isHotStock(item.id, yesterday));
    const thisWeek = isCold && (status === "urgente" || (status === "pronto" && daysLeft !== null && daysLeft <= urgentDays + COLD_WEEK_AHEAD_DAYS));
    // Si con lo que hay ya alcanza para todo ese tiempo, todavía no se sugiere nada.
    const suggestedQty = status !== "en_compra" && status !== "no_sale" && status !== "falta_contar" ? suggestedQuantity(perDay, urgentDays, stock) : null;
    const row: SuggestionRow = {
      catalogItemId: item.id,
      name: item.name,
      justCode: item.justCode,
      photo: item.photos[0] ?? null,
      stock,
      sold: units,
      perDay,
      daysLeft,
      status,
      openPurchase,
      escalated,
      supplierName: supplier?.name ?? null,
      urgentDays,
      suggestedQty,
      supplierOut: supplierOut ? { reportId: supplierOut.reportId, since: supplierOut.since.toISOString(), askAt: supplierOut.askAt.toISOString() } : null,
      thisWeek,
      discard: status === "descartado" ? discard : null,
      discardReturned: status === "falta_contar" ? null : discardReturned,
      variants: null,
      counted: gate.active && !isSupply ? !uncounted : null,
      countedUrgent: status === "falta_contar" && baseStatus === "urgente",
      newToday,
      countMark: null,
      countRequest: null,
      coldSoon: isCold && isColdSoonStock(item.id, stock) && (status === "urgente" || status === "pronto"),
    };
    // Sin contar y con stock "de sobra" o negativo: solo como "Falta contar" en calientes.
    if (uncountedSelling(item.id, stock) && (stock < 0 || stock > COLD_MAX)) {
      if (status === "falta_contar") hot.push(row);
    } else if (isHot) hot.push(row);
    else if (stock <= COLD_MAX || row.coldSoon) cold.push(row);
  }

  const [marks, countRequests] = await Promise.all([getCountMarks([...hot, ...cold].map((r) => r.catalogItemId)), getOpenCountRequests()]);
  for (const r of [...hot, ...cold]) {
    r.countMark = marks.get(r.catalogItemId) ?? null;
    const req = countRequests.get(r.catalogItemId);
    r.countRequest = req ? { at: req.at, byName: req.byName } : null;
  }

  // Reparto por color/talla (Ventas por variante): solo con 2 variantes o
  // más y suficientes unidades leídas para que el reparto signifique algo.
  const rowIds = [...hot, ...cold].filter((r) => r.status !== "no_sale").map((r) => r.catalogItemId);
  if (rowIds.length > 0) {
    const { products } = await getVariantSales({ days: WINDOW_DAYS, catalogItemIds: rowIds });
    const mixByItem = new Map(products.filter((p) => p.variants.length >= 2 && p.variantUnits >= MIX_MIN_UNITS).map((p) => [p.catalogItemId, p.variants.map(({ label, units }) => ({ label, units }))]));
    for (const r of [...hot, ...cold]) r.variants = mixByItem.get(r.catalogItemId) ?? null;
  }

  const proposals = readyIds.length
    ? await prisma.marketProductProposal.findMany({
        where: { id: { in: readyIds } },
        select: { id: true, code: true, productName: true, referenceImageUrl: true, readyToBuyAt: true },
        orderBy: { readyToBuyAt: "asc" },
      })
    : [];

  const coldReady = new Set(readyByBuyer.cold);
  const toNewProduct = (p: (typeof proposals)[number]): NewProductRow => ({
    proposalId: p.id,
    code: p.code,
    name: p.productName,
    photo: p.referenceImageUrl || null,
    readyToBuyAt: p.readyToBuyAt!.toISOString(),
  });

  return {
    windowDays,
    hot: sortRows(hot),
    cold: sortRows(cold),
    newProducts: proposals.filter((p) => !coldReady.has(p.id)).map(toNewProduct),
    coldNewProducts: proposals.filter((p) => coldReady.has(p.id)).map(toNewProduct),
  };
}

// ---- Avisos (Inicio + notificación de las 8:00) ---------------------------

export type SuggestionAudience = "hot" | "cold" | "escalation";

// Pedido del usuario 2026-10-13: quién hace cada lista lo deciden dos
// interruptores del perfil (solo el admin los cambia), no el departamento ni
// el cargo. Puede haber varias personas por lista. Si nadie tiene uno, los
// avisos de esa lista le llegan al admin con un recordatorio diario de que
// falta asignar a alguien (ver getBuyerGapReminders).
export async function getHotBuyerIds(): Promise<string[]> {
  const users = await prisma.user.findMany({ where: { isActive: true, handlesHotPurchases: true }, select: { id: true } });
  return users.map((u) => u.id);
}

export async function getColdBuyerIds(): Promise<string[]> {
  const users = await prisma.user.findMany({ where: { isActive: true, handlesColdPurchases: true }, select: { id: true } });
  return users.map((u) => u.id);
}

// Nombres para los títulos de la pestaña ("· JARIEL", "· sin encargado").
export async function getBuyerNames(): Promise<{ hot: string[]; cold: string[] }> {
  const users = await prisma.user.findMany({
    where: { isActive: true, OR: [{ handlesHotPurchases: true }, { handlesColdPurchases: true }] },
    select: { name: true, handlesHotPurchases: true, handlesColdPurchases: true },
    orderBy: { name: "asc" },
  });
  return { hot: users.filter((u) => u.handlesHotPurchases).map((u) => u.name), cold: users.filter((u) => u.handlesColdPurchases).map((u) => u.name) };
}

export async function getSuggestionAudiencesForUser(userId: string): Promise<SuggestionAudience[]> {
  const [hotIds, coldIds, inventoryLeadId] = await Promise.all([getHotBuyerIds(), getColdBuyerIds(), getInventoryLeadId()]);
  const out: SuggestionAudience[] = [];
  if (hotIds.includes(userId)) out.push("hot");
  if (coldIds.includes(userId)) out.push("cold");
  if (inventoryLeadId === userId) out.push("escalation");
  return out;
}

export const BUYER_GAP_TYPE = "compras_sin_encargado";
const BUYER_GAP_LABEL: Record<"hot" | "cold", string> = { hot: "compras calientes", cold: "compras frías" };

// Recordatorio al admin mientras una lista no tenga a nadie con su interruptor.
export function buyerGapNotice(audience: "hot" | "cold"): { type: string; icon: string; label: string; meta: string; body: string } {
  const what = BUYER_GAP_LABEL[audience];
  return {
    type: BUYER_GAP_TYPE,
    icon: "⚠️",
    label: `Nadie tiene a cargo las ${what}`,
    meta: `Mientras no asignes a alguien, los avisos de ${what} te llegan a ti`,
    body: `Nadie tiene encendido el interruptor de ${what}, así que sus avisos te llegan a ti. Para que la cadena de suministro no se detenga, enciéndelo en el perfil de quien deba encargarse (Nómina → perfil → permisos).`,
  };
}

const ADMIN_NOMINA_HREF = "/admin/nomina";

function plural(n: number, one: string, many: string) {
  return `${n} ${n === 1 ? one : many}`;
}

function daysText(d: number | null): string {
  if (d === null) return "";
  if (d < 1) return "se acaba hoy";
  const n = Math.floor(d);
  return `alcanza ${n} día${n === 1 ? "" : "s"}`;
}

export type SuggestionNotice = { audience: SuggestionAudience; type: string; icon: string; label: string; meta: string; body: string; overdue: boolean };

export function buildSuggestionNotice(s: PurchaseSuggestions, audience: SuggestionAudience): SuggestionNotice | null {
  if (audience === "escalation") {
    const rows = [...s.hot, ...s.cold].filter((r) => r.escalated);
    if (rows.length === 0) return null;
    const names = rows.slice(0, 4).map((r) => `${r.name} (${daysText(r.daysLeft)})`).join("; ");
    const more = rows.length > 4 ? ` y ${rows.length - 4} más` : "";
    return {
      audience,
      type: "compras_urgentes_sin_atender",
      icon: "🚨",
      label: "Compras urgentes sin atender",
      meta: `${plural(rows.length, "producto", "productos")} urgente${rows.length === 1 ? "" : "s"} sin comprar (${ESCALATE_DAYS}+ días en calientes, ${COLD_ESCALATE_DAYS}+ en frías)`,
      body: `Están urgentes desde hace días (${ESCALATE_DAYS}+ en compras calientes, ${COLD_ESCALATE_DAYS}+ en frías) y nadie los compró ni los descartó: ${names}${more}.`,
      overdue: true,
    };
  }
  if (audience === "cold") {
    const week = s.cold.filter((r) => r.thisWeek);
    if (week.length === 0) return null;
    const urgentCold = week.filter((r) => r.status === "urgente").length;
    const names = week
      .slice(0, 3)
      .map((r) => `${r.name} (${daysText(r.daysLeft)}${r.suggestedQty ? `, comprar ~${r.suggestedQty}` : ""})`)
      .join("; ");
    const meta = `${plural(week.length, "producto", "productos")} por comprar o descartar esta semana${urgentCold ? ` · ${urgentCold} urgente${urgentCold === 1 ? "" : "s"}` : ""}`;
    return {
      audience,
      type: "compras_frias",
      icon: "❄️",
      label: "Compras frías de esta semana",
      meta,
      body: `${meta}. ${names}${week.length > 3 ? ` y ${week.length - 3} más` : ""}.`,
      overdue: week.some((r) => r.escalated),
    };
  }
  // Pedido del usuario 2026-10-02: a Jariel solo lo que de verdad es urgente
  // (sin "pronto" ni productos nuevos, que tienen su propio pendiente), para
  // no saturarlo. Los "sin proveedor" solo cuentan el día que toca preguntar.
  // Desde 2026-10-13 (pedido de Jariel) toda la lista caliente se acaba en
  // HOT_DAYS o menos: el aviso diario repite TODAS las que siguen sin
  // gestionar (sin compra abierta ni marca de proveedor) y marca las nuevas.
  const rows = s.hot;
  const urgent = [...rows.filter((r) => r.status === "urgente" && r.newToday), ...rows.filter((r) => r.status === "urgente" && !r.newToday)];
  const fresh = urgent.filter((r) => r.newToday).length;
  const ask = rows.filter((r) => r.status === "preguntar_proveedor").length;
  if (urgent.length === 0 && ask === 0) return null;
  const parts = [
    urgent.length ? `${plural(urgent.length, "compra caliente", "compras calientes")} sin gestionar` : null,
    fresh ? plural(fresh, "nueva hoy", "nuevas hoy") : null,
    ask ? `${ask} por preguntar al proveedor` : null,
  ].filter(Boolean);
  const SHOWN = 8;
  const top =
    urgent
      .slice(0, SHOWN)
      .map((r) => `${r.newToday ? "🆕 " : ""}${r.name} (${daysText(r.daysLeft)}${r.suggestedQty ? `, comprar ~${r.suggestedQty}` : ""})`)
      .join("; ") + (urgent.length > SHOWN ? ` y ${urgent.length - SHOWN} más` : "");
  const askNames = rows
    .filter((r) => r.status === "preguntar_proveedor")
    .slice(0, 3)
    .map((r) => r.name)
    .join("; ");
  return {
    audience,
    type: "compras_calientes",
    icon: "🔥",
    label: "Compras calientes",
    meta: parts.join(" · "),
    body: `${parts.join(" · ")}${top ? `. Se acaban en ${HOT_DAYS} días o menos: ${top}` : ""}${askNames ? `. ¿El proveedor ya tiene: ${askNames}?` : "."}`,
    overdue: urgent.some((r) => r.escalated),
  };
}

export const PURCHASE_SUGGESTIONS_HREF = "/area/workspace?tab=compras&ptab=que-comprar";
export const COUNT_FIRST_TYPE = "compras_falta_contar";
export const STOCK_COUNT_HREF = "/area/conteo-inventario";

// Pedido del usuario 2026-10-13: lo que no se contó no se puede comprar. Al
// líder de Inventario le sale lo que ya estaría urgente para que lo cuente
// primero (él puede contar cualquier producto del conteo general).
// Aviso diario de compras frías (2026-10-14): lo que se acaba en 4–5 días.
export const COLD_SOON_TYPE = "compras_frias_pronto";
export function buildColdSoonNotice(s: PurchaseSuggestions): SuggestionNotice | null {
  const rows = s.cold.filter((r) => r.coldSoon);
  if (rows.length === 0) return null;
  const SHOWN = 6;
  const names = rows
    .slice(0, SHOWN)
    .map((r) => `${r.name} (${daysText(r.daysLeft)}${r.suggestedQty ? `, comprar ~${r.suggestedQty}` : ""})`)
    .join("; ");
  const meta = `${plural(rows.length, "producto se acaba", "productos se acaban")} en ${COLD_SOON_DAYS} días o menos`;
  return {
    audience: "cold",
    type: COLD_SOON_TYPE,
    icon: "⏰",
    label: "Compras frías que se acaban pronto",
    meta,
    body: `${meta}: ${names}${rows.length > SHOWN ? ` y ${rows.length - SHOWN} más` : ""}. Si no se compran, en unos días pasan a compras calientes.`,
    overdue: false,
  };
}

export function buildCountFirstNotice(s: PurchaseSuggestions): SuggestionNotice | null {
  const rows = [...s.hot, ...s.cold].filter((r) => r.countedUrgent);
  if (rows.length === 0) return null;
  const names = rows.slice(0, 4).map((r) => r.name).join("; ");
  const meta = `${plural(rows.length, "producto urgente", "productos urgentes")} de Qué comprar sin contar — no se pueden comprar hasta contarlos`;
  return {
    audience: "escalation",
    type: COUNT_FIRST_TYPE,
    icon: "🔢",
    label: "Cuenta primero lo que hay que comprar",
    meta,
    body: `${meta}: ${names}${rows.length > 4 ? ` y ${rows.length - 4} más` : ""}.`,
    overdue: true,
  };
}

// Para el cron de las 8:00: un aviso por persona, con su resumen.
export async function getPurchaseSuggestionPushes(): Promise<{ ownerId: string; type: string; title: string; body: string; url: string; mandatory?: boolean }[]> {
  const [hotIds, coldIds, inventoryLeadId] = await Promise.all([getHotBuyerIds(), getColdBuyerIds(), getInventoryLeadId()]);
  const out: { ownerId: string; type: string; title: string; body: string; url: string; mandatory?: boolean }[] = [];
  // Pedido del usuario 2026-10-13: "siempre recordarme" — el recordatorio de
  // lista sin encargado sale todos los días (también durante el conteo) y no
  // se puede apagar desde las preferencias.
  for (const audience of ["hot", "cold"] as const) {
    if ((audience === "hot" ? hotIds : coldIds).length > 0) continue;
    const g = buyerGapNotice(audience);
    out.push({ ownerId: "admin", type: g.type, title: `DAFLOW · ${g.label}`, body: g.body, url: ADMIN_NOMINA_HREF, mandatory: true });
  }
  if (isPhysicalCountPause()) return out;
  const [s, adminHref] = await Promise.all([getPurchaseSuggestions(), adminSuggestionsHref()]);
  const add = (ids: (string | null)[], audience: SuggestionAudience) => {
    const n = buildSuggestionNotice(s, audience);
    if (!n) return;
    // Sin encargado: el aviso de la lista le llega al admin.
    const owners = ids.filter((id): id is string => !!id);
    if (owners.length === 0 && audience !== "escalation") owners.push("admin");
    for (const id of owners) out.push({ ownerId: id, type: n.type, title: `DAFLOW · ${n.label}`, body: n.body, url: id === "admin" ? adminHref : PURCHASE_SUGGESTIONS_HREF });
  };
  add(hotIds, "hot");
  // Compras frías: el aviso sale solo los lunes (en Inicio se queda toda la semana).
  if (new Date().toLocaleDateString("en-US", { weekday: "short", timeZone: "America/Guayaquil" }) === "Mon") add(coldIds, "cold");
  // ...y todos los días, lo que se acaba en 4–5 días (2026-10-14).
  const soon = buildColdSoonNotice(s);
  if (soon) {
    const owners: string[] = coldIds.length > 0 ? coldIds : ["admin"];
    for (const id of owners) out.push({ ownerId: id, type: soon.type, title: `DAFLOW · ${soon.label}`, body: soon.body, url: id === "admin" ? adminHref : PURCHASE_SUGGESTIONS_HREF });
  }
  add([inventoryLeadId], "escalation");
  const countFirst = buildCountFirstNotice(s);
  if (countFirst && inventoryLeadId) out.push({ ownerId: inventoryLeadId, type: countFirst.type, title: `DAFLOW · ${countFirst.label}`, body: countFirst.body, url: STOCK_COUNT_HREF });
  return out;
}

// Tarjetas de Inicio de esta persona (quien tenga el interruptor de calientes
// o frías, o el líder de Inventario por los urgentes sin atender).
export async function getPurchaseSuggestionPendingItems(userId: string, href: string = PURCHASE_SUGGESTIONS_HREF) {
  if (isPhysicalCountPause()) return [];
  const audiences = await getSuggestionAudiencesForUser(userId);
  if (audiences.length === 0) return [];
  const s = await getPurchaseSuggestions();
  const items = audiences
    .map((a) => buildSuggestionNotice(s, a))
    .filter((n): n is SuggestionNotice => !!n)
    .map((n) => ({ type: n.type, icon: n.icon, label: n.label, meta: n.meta, overdue: n.overdue, href }));
  const countFirst = audiences.includes("escalation") ? buildCountFirstNotice(s) : null;
  if (countFirst) items.unshift({ type: countFirst.type, icon: countFirst.icon, label: countFirst.label, meta: countFirst.meta, overdue: true, href: STOCK_COUNT_HREF });
  const soon = audiences.includes("cold") ? buildColdSoonNotice(s) : null;
  if (soon) items.unshift({ type: soon.type, icon: soon.icon, label: soon.label, meta: soon.meta, overdue: soon.overdue, href });
  // "Pedir que lo cuenten" (2026-10-14): se queda en su Inicio hasta contarlo.
  const asked = audiences.includes("escalation") ? await getCountRequestPendingItem() : null;
  if (asked) items.unshift(asked);
  return items;
}

// Inicio del admin: por cada lista sin encargado, el recordatorio (siempre
// arriba) y la tarjeta de esa lista que le tocaría a esa persona.
export async function getPurchaseSuggestionAdminPendingItems() {
  const [hotIds, coldIds] = await Promise.all([getHotBuyerIds(), getColdBuyerIds()]);
  const missing = (["hot", "cold"] as const).filter((a) => (a === "hot" ? hotIds : coldIds).length === 0);
  if (missing.length === 0) return [];
  const items: { type: string; icon: string; label: string; meta: string; overdue: boolean; href: string }[] = missing.map((a) => {
    const g = buyerGapNotice(a);
    return { type: g.type, icon: g.icon, label: g.label, meta: g.meta, overdue: true, href: ADMIN_NOMINA_HREF };
  });
  if (isPhysicalCountPause()) return items;
  const [s, href] = await Promise.all([getPurchaseSuggestions(), adminSuggestionsHref()]);
  for (const a of missing) {
    const n = buildSuggestionNotice(s, a);
    if (n) items.push({ type: n.type, icon: n.icon, label: n.label, meta: n.meta, overdue: n.overdue, href });
    const soon = a === "cold" ? buildColdSoonNotice(s) : null;
    if (soon) items.push({ type: soon.type, icon: soon.icon, label: soon.label, meta: soon.meta, overdue: soon.overdue, href });
  }
  return items;
}

// ---- "Pedir que lo cuenten" (pedido del usuario 2026-10-13) ---------------

// 2026-10-14 (pedido de Jariel): el aviso sí llegaba, pero Daniel lo leía en
// la campanita y no quedaba nada — ni en su Inicio ni en la fila de Jariel
// (al recargar, el botón volvía como si nunca se hubiera pedido). Ahora el
// pedido se guarda en la misma notificación (el producto va en el enlace) y
// sigue abierto hasta que el producto se vuelva a contar (conteo físico o
// "Ajustar (conteo)" en Stock Actual), con un máximo de COUNT_REQUEST_DAYS.
// También se puede pedir un producto ya contado (urgente con stock que no
// cuadra): Daniel lo verifica.
export const COUNT_REQUEST_TITLE = "🔢 Piden contar un producto";
export const COUNT_REQUEST_TYPE = "compras_pedido_conteo";
const COUNT_REQUEST_DAYS = 7;
const COUNT_REQUEST_PARAM = "pedido=";

export type CountRequest = { at: string; byName: string };

// Pedidos abiertos por producto (el más reciente de cada uno).
export async function getOpenCountRequests(): Promise<Map<string, CountRequest & { name: string }>> {
  const leadId = await getInventoryLeadId();
  if (!leadId) return new Map();
  const notes = await prisma.notification.findMany({
    where: { ownerId: leadId, title: COUNT_REQUEST_TITLE, url: { contains: COUNT_REQUEST_PARAM }, createdAt: { gte: new Date(Date.now() - COUNT_REQUEST_DAYS * DAY_MS) } },
    select: { body: true, url: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });
  const latest = new Map<string, { at: Date; byName: string; name: string }>();
  for (const n of notes) {
    const id = n.url?.split(COUNT_REQUEST_PARAM)[1]?.split("&")[0];
    if (!id || latest.has(id)) continue;
    const m = /^(.+?) (?:necesita comprar|pide volver a contar) "(.+?)"/.exec(n.body);
    latest.set(id, { at: n.createdAt, byName: m?.[1] ?? "Alguien", name: m?.[2] ?? "producto" });
  }
  if (latest.size === 0) return new Map();
  const ids = [...latest.keys()];
  const [lines, adjustments] = await Promise.all([
    prisma.stockCountLine.findMany({ where: { catalogItemId: { in: ids } }, select: { catalogItemId: true, countedAt: true }, orderBy: { countedAt: "desc" }, distinct: ["catalogItemId"] }),
    prisma.stockPhysicalCountAdjustmentRequest.findMany({ where: { catalogItemId: { in: ids } }, select: { catalogItemId: true, requestedAt: true } }),
  ]);
  const doneAt = new Map<string, Date>();
  for (const x of [...lines.map((l) => ({ id: l.catalogItemId, at: l.countedAt })), ...adjustments.map((a) => ({ id: a.catalogItemId, at: a.requestedAt }))]) {
    const cur = doneAt.get(x.id);
    if (!cur || x.at > cur) doneAt.set(x.id, x.at);
  }
  const out = new Map<string, CountRequest & { name: string }>();
  for (const [id, r] of latest) {
    const done = doneAt.get(id);
    if (done && done > r.at) continue;
    out.set(id, { at: r.at.toISOString(), byName: r.byName, name: r.name });
  }
  return out;
}

export async function requestProductCount(catalogItemId: string, actorName: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const item = await prisma.purchaseCatalogItem.findUnique({ where: { id: catalogItemId }, select: { name: true } });
  if (!item) return { ok: false, error: "Producto no encontrado." };
  const leadId = await getInventoryLeadId();
  if (!leadId) return { ok: false, error: "No hay líder de Inventario a quien avisarle." };
  const open = (await getOpenCountRequests()).get(catalogItemId);
  if (open) return { ok: false, error: `Ya se le pidió a Daniel (${open.byName}). Le sigue saliendo en su Inicio hasta que lo cuente.` };
  const [uncounted] = await findUncountedItems([catalogItemId]);
  const body = uncounted
    ? `${actorName} necesita comprar "${item.name}" y todavía no se cuenta en el conteo físico. Cuéntalo en el conteo general para que se pueda comprar.`
    : `${actorName} pide volver a contar "${item.name}" antes de comprarlo: el stock que dice el sistema puede no ser el real. Si ya se aplicó, corrígelo con «Ajustar (conteo)» en Stock Actual.`;
  await notifyOwner(leadId, { title: COUNT_REQUEST_TITLE, body, url: `${STOCK_COUNT_HREF}?${COUNT_REQUEST_PARAM}${catalogItemId}` });
  return { ok: true };
}

// Inicio del líder de Inventario: los productos que le pidieron contar.
export async function getCountRequestPendingItem(href: string = STOCK_COUNT_HREF) {
  const open = [...(await getOpenCountRequests()).values()];
  if (open.length === 0) return null;
  const names = open.slice(0, 3).map((r) => `${r.name} (${r.byName.split(" ")[0]})`).join("; ");
  return {
    type: COUNT_REQUEST_TYPE,
    icon: "🔢",
    label: `Te pidieron contar ${plural(open.length, "producto", "productos")} para comprar`,
    meta: `${names}${open.length > 3 ? ` y ${open.length - 3} más` : ""}`,
    overdue: open.some((r) => Date.now() - new Date(r.at).getTime() > DAY_MS),
    href,
  };
}

// ---- "No hace falta comprarlo" (pedido del usuario 2026-10-02) -----------

// Líder de Análisis de Mercado (hoy Bryan Ríos): recibe cada descarte.
async function getMarketAnalysisLeadId(): Promise<string | null> {
  const lead = await prisma.user.findFirst({ where: { isActive: true, isLeader: true, leadsDept: { code: "MKT" } }, select: { id: true } });
  return lead?.id ?? null;
}

async function adminSuggestionsHref(): Promise<string> {
  const com = await prisma.department.findUnique({ where: { code: "COM" }, select: { id: true } });
  return com ? `/admin/dept/${com.id}?tab=compras&ptab=que-comprar` : "/admin";
}

// Quién puede descartar: quien tenga el interruptor de compras frías y el admin.
export async function canDiscardSuggestions(userId: string | null, isAdmin: boolean): Promise<boolean> {
  if (isAdmin) return true;
  if (!userId) return false;
  return (await getColdBuyerIds()).includes(userId);
}

export async function discardSuggestion(params: {
  catalogItemId: string;
  reason: string;
  note: string | null;
  userId: string | null;
  actorName: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!DISCARD_REASONS[params.reason]) return { ok: false, error: "Elige un motivo." };
  const note = params.note?.trim() || null;
  if (params.reason === "OTHER" && (!note || note.length < 5)) return { ok: false, error: "Describe por qué no hace falta comprarlo (mínimo 5 letras)." };
  const s = await getPurchaseSuggestions();
  const row = s.cold.find((r) => r.catalogItemId === params.catalogItemId);
  if (!row || (row.status !== "urgente" && row.status !== "pronto")) return { ok: false, error: "Este producto ya no está por comprar en compras frías — recarga la lista." };

  await prisma.purchaseSuggestionDiscard.create({
    data: {
      catalogItemId: row.catalogItemId,
      reason: params.reason,
      note,
      statusAtDiscard: row.status,
      stockAtDiscard: row.stock,
      daysLeftAtDiscard: row.daysLeft,
      discardedById: params.userId,
    },
  });

  const why = `${DISCARD_REASONS[params.reason]}${note ? ` — ${note}` : ""}`;
  const days = row.daysLeft === null ? "" : row.daysLeft < 1 ? ", se acaba hoy" : `, alcanza ${Math.floor(row.daysLeft)} días`;
  const body = `${params.actorName} dijo que no hace falta comprar ${row.name}${row.status === "urgente" ? " (estaba URGENTE)" : ""}. Motivo: ${why}. Quedan ${row.stock}${days}.`;
  const [mktLeadId, adminHref] = await Promise.all([getMarketAnalysisLeadId(), adminSuggestionsHref()]);
  if (mktLeadId && mktLeadId !== params.userId) {
    await notifyOwner(mktLeadId, { title: "Compra fría descartada", body, url: PURCHASE_SUGGESTIONS_HREF }).catch(() => null);
  }
  await notifyOwner("admin", { title: "Compra fría descartada", body, url: adminHref }).catch(() => null);
  return { ok: true };
}

// "Volver a la lista": deshace un descarte antes de tiempo.
export async function undoDiscard(params: { discardId: string; userId: string | null }): Promise<{ ok: true } | { ok: false; error: string }> {
  const updated = await prisma.purchaseSuggestionDiscard.updateMany({
    where: { id: params.discardId, undoneAt: null },
    data: { undoneAt: new Date(), undoneById: params.userId },
  });
  if (updated.count === 0) return { ok: false, error: "Este descarte ya no está vigente." };
  return { ok: true };
}

// ---- Aviso inmediato de compra caliente (aprobado 2026-10-16) --------------
// Apenas un producto pasa a "se acaba en HOT_DAYS días o menos" y nadie lo
// está comprando, le llega un aviso a quien hace las compras calientes, sin
// esperar al resumen de las 8:00. Una vez por producto al día; fuera de
// horario o en domingo/feriado no se avisa (queda para el resumen de la
// mañana). Solo con el conteo general cerrado: antes el stock no era real.
// Se llama cuando Daniel confirma lo que salió en un corte (baja el stock).
export async function notifyNewHotUrgents(now = new Date()): Promise<number> {
  if (!isWithinBusinessHours(now)) return 0;
  const settings = await prisma.platformSettings.findUnique({ where: { id: "singleton" }, select: { fullStockCountCompletedAt: true } });
  if (!settings?.fullStockCountCompletedAt) return 0;
  const buyers = await getHotBuyerIds();
  if (buyers.length === 0) return 0;
  const s = await getPurchaseSuggestions();
  const urgent = s.hot.filter((r) => r.status === "urgente");
  if (urgent.length === 0) return 0;
  const dayStart = new Date(`${new Date(now.getTime() - 5 * 3_600_000).toISOString().slice(0, 10)}T05:00:00Z`);
  const urlOf = (id: string) => `${PURCHASE_SUGGESTIONS_HREF}&hot=${id}`;
  const sent = await prisma.notification.findMany({
    where: { ownerId: { in: buyers }, createdAt: { gte: dayStart }, url: { in: urgent.map((r) => urlOf(r.catalogItemId)) } },
    select: { url: true },
  });
  const already = new Set(sent.map((n) => n.url));
  // Lo que ya salió en el resumen de las 8:00 de hoy tampoco se repite.
  const fresh = urgent.filter((r) => r.newToday && !already.has(urlOf(r.catalogItemId))).slice(0, 5);
  for (const r of fresh) {
    const qty = r.suggestedQty ? ` Sugerido: comprar ~${r.suggestedQty}.` : "";
    for (const ownerId of buyers) {
      await notifyOwner(ownerId, {
        title: "🔥 Compra caliente nueva",
        body: `${r.name}: quedan ${Math.max(0, r.stock)} u. y ${daysText(r.daysLeft)} con lo que se vende.${qty}`,
        url: urlOf(r.catalogItemId),
      }).catch(() => null);
    }
  }
  return fresh.length;
}
