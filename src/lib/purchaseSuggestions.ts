import { prisma } from "@/lib/prisma";
import { getFinanceLeadId, getInventoryLeadId } from "@/lib/guards";
import { formatPurchaseRequestCode, OPEN_PURCHASE_STATUSES, openPurchaseWhere } from "@/lib/purchases";
import { getReadyToBuyPendingProposalIdsByBuyer } from "@/lib/marketProduct";
import { notifyOwner } from "@/lib/notifications";
import { getVariantSales, MIX_MIN_UNITS } from "@/lib/variantSales";

// Confirmado 2026-09-29, idea de Daniel aprobada por el usuario: "Qué
// comprar". Compras calientes (30 o menos, más los productos nuevos que
// nunca entraron a bodega) → Jariel; compras frías (31 a 60) → Nairoby. Las
// cantidades son iguales para todos los productos (decisión del usuario).
// Dentro de cada lista manda lo que de verdad se vende: un producto con poco
// stock que no sale no es prioridad (ejemplo de Daniel). Si un urgente pasa
// 3 días sin comprarse, se avisa a Daniel. Todo se calcula al leer, sin
// guardar nada en la base.
export const HOT_MAX = 30;
export const COLD_MAX = 60;
// Confirmado 2026-10-01 por Daniel: "urgente" = lo que tarda el proveedor en
// traerlo + días de seguridad. 15 días con CHEN (proveedor a crédito,
// importa) y 7 con los demás. El proveedor es el de la última compra del
// producto; sin compra en DAFLOW, 7.
export const URGENT_DAYS = 7;
export const URGENT_DAYS_CREDIT_SUPPLIER = 15;
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
export type SuggestionStatus = "preguntar_proveedor" | "urgente" | "pronto" | "sin_proveedor" | "descartado" | "no_sale" | "en_compra";

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

const STATUS_ORDER: Record<SuggestionStatus, number> = { preguntar_proveedor: 0, urgente: 1, pronto: 2, sin_proveedor: 3, en_compra: 4, descartado: 5, no_sale: 6 };

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
export async function getSalesWindow(now = new Date()): Promise<{ windowStart: Date; windowDays: number }> {
  const firstBatch = await prisma.fulfillmentRequestBatch.findFirst({ orderBy: { requestedAt: "asc" }, select: { requestedAt: true } });
  const windowStart = new Date(Math.max(now.getTime() - WINDOW_DAYS * DAY_MS, firstBatch?.requestedAt.getTime() ?? now.getTime()));
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
    prisma.purchaseCatalogItem.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }),
  ]);
  const name = new Map(items.map((i) => [i.id, i.name]));
  const mode = new Map(lastPurchases.map((p) => [p.catalogItemId, p.supplier.paymentMode]));
  const out: { catalogItemId: string; message: string }[] = [];
  for (const b of balances) {
    const perDay = (sold.get(b.catalogItemId) ?? 0) / windowDays;
    if (!stockStillCovers(b.balanceAfter, perDay, urgentDaysForSupplier(mode.get(b.catalogItemId)))) continue;
    const daysLeft = perDay > 0 ? b.balanceAfter / perDay : null;
    out.push({ catalogItemId: b.catalogItemId, message: stockCoverMessage(name.get(b.catalogItemId) ?? "este producto", b.balanceAfter, daysLeft) });
  }
  return out;
}

export async function getPurchaseSuggestions(): Promise<PurchaseSuggestions> {
  const now = new Date();
  const { windowStart, windowDays } = await getSalesWindow(now);

  const [balances, balancesBefore, balancesBeforeCold, sold, openPurchases, readyByBuyer] = await Promise.all([
    latestBalances(),
    latestBalances(new Date(now.getTime() - ESCALATE_DAYS * DAY_MS)),
    latestBalances(new Date(now.getTime() - COLD_ESCALATE_DAYS * DAY_MS)),
    getSoldUnitsByItem(windowStart),
    prisma.purchaseRequest.findMany({
      where: openPurchaseWhere(),
      select: { catalogItemId: true, requestNumber: true, quantity: true },
      orderBy: { createdAt: "desc" },
    }),
    getReadyToBuyPendingProposalIdsByBuyer(),
  ]);
  const readyIds = [...readyByBuyer.hot, ...readyByBuyer.cold];

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
  const candidateIds = [...balances.entries()].filter(([, bal]) => bal >= 0 && bal <= COLD_MAX).map(([id]) => id);
  const [items, lastPurchases, stockoutReports, discards] = await Promise.all([
    prisma.purchaseCatalogItem.findMany({
      where: { id: { in: candidateIds }, awaitingDropiId: false },
      select: { id: true, name: true, photos: true, justCode: true },
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
    const baseStatus: SuggestionStatus = openPurchase
      ? "en_compra"
      : perDay === 0
        ? "no_sale"
        : supplierOut
          ? supplierOut.askAt <= now
            ? "preguntar_proveedor"
            : "sin_proveedor"
          : daysLeft! <= urgentDays
            ? "urgente"
            : "pronto";
    // Descarte de Nairoby: solo en compras frías y solo sobre urgente/pronto.
    const isCold = stock > HOT_MAX;
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
    const status: SuggestionStatus = discard && (baseStatus === "urgente" || baseStatus === "pronto") ? "descartado" : baseStatus;
    // Ya era urgente hace 3 días (7 en compras frías) con el stock de ese día y la venta de hoy.
    const before = (isCold ? balancesBeforeCold : balancesBefore).get(item.id);
    const escalated = status === "urgente" && before !== undefined && Math.max(0, before) / perDay <= urgentDays;
    const thisWeek = isCold && (status === "urgente" || (status === "pronto" && daysLeft !== null && daysLeft <= urgentDays + COLD_WEEK_AHEAD_DAYS));
    // Si con lo que hay ya alcanza para todo ese tiempo, todavía no se sugiere nada.
    const suggestedQty = status !== "en_compra" && status !== "no_sale" ? suggestedQuantity(perDay, urgentDays, stock) : null;
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
      discardReturned,
      variants: null,
    };
    (stock <= HOT_MAX ? hot : cold).push(row);
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

// Jariel: hace las compras en Análisis de Mercado (mismo criterio que
// purchaseDeciderIds en fulfillmentGuides.ts, sin quien solo aprueba).
export async function getHotBuyerIds(): Promise<string[]> {
  const users = await prisma.user.findMany({
    where: { isActive: true, canManagePurchases: true, purchasingNewRequestsBlocked: false, department: { code: "MKT" } },
    select: { id: true },
  });
  return users.map((u) => u.id);
}

export async function getSuggestionAudiencesForUser(userId: string): Promise<SuggestionAudience[]> {
  const [hotIds, financeLeadId, inventoryLeadId] = await Promise.all([getHotBuyerIds(), getFinanceLeadId(), getInventoryLeadId()]);
  const out: SuggestionAudience[] = [];
  if (hotIds.includes(userId)) out.push("hot");
  if (financeLeadId === userId) out.push("cold");
  if (inventoryLeadId === userId) out.push("escalation");
  return out;
}

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
  const rows = s.hot;
  const urgent = rows.filter((r) => r.status === "urgente");
  const ask = rows.filter((r) => r.status === "preguntar_proveedor").length;
  if (urgent.length === 0 && ask === 0) return null;
  const parts = [
    urgent.length ? plural(urgent.length, "urgente", "urgentes") : null,
    ask ? `${ask} por preguntar al proveedor` : null,
  ].filter(Boolean);
  const top = urgent
    .slice(0, 3)
    .map((r) => `${r.name} (${daysText(r.daysLeft)}${r.suggestedQty ? `, comprar ~${r.suggestedQty}` : ""})`)
    .join("; ");
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
    body: `${parts.join(" · ")}${top ? `. Primero: ${top}` : ""}${askNames ? `. ¿El proveedor ya tiene: ${askNames}?` : "."}`,
    overdue: urgent.some((r) => r.escalated),
  };
}

export const PURCHASE_SUGGESTIONS_HREF = "/area/workspace?tab=compras&ptab=que-comprar";

// Para el cron de las 8:00: un aviso por persona, con su resumen.
export async function getPurchaseSuggestionPushes(): Promise<{ ownerId: string; type: string; title: string; body: string; url: string }[]> {
  if (isPhysicalCountPause()) return [];
  const [s, hotIds, financeLeadId, inventoryLeadId] = await Promise.all([getPurchaseSuggestions(), getHotBuyerIds(), getFinanceLeadId(), getInventoryLeadId()]);
  const out: { ownerId: string; type: string; title: string; body: string; url: string }[] = [];
  const add = (ids: (string | null)[], audience: SuggestionAudience) => {
    const n = buildSuggestionNotice(s, audience);
    if (!n) return;
    for (const id of ids) if (id) out.push({ ownerId: id, type: n.type, title: `DAFLOW · ${n.label}`, body: n.body, url: PURCHASE_SUGGESTIONS_HREF });
  };
  add(hotIds, "hot");
  // Compras frías: el aviso sale solo los lunes (en Inicio se queda toda la semana).
  if (new Date().toLocaleDateString("en-US", { weekday: "short", timeZone: "America/Guayaquil" }) === "Mon") add([financeLeadId], "cold");
  add([inventoryLeadId], "escalation");
  return out;
}

// Tarjetas de Inicio de esta persona (Jariel, Nairoby o Daniel).
export async function getPurchaseSuggestionPendingItems(userId: string, href: string = PURCHASE_SUGGESTIONS_HREF) {
  if (isPhysicalCountPause()) return [];
  const audiences = await getSuggestionAudiencesForUser(userId);
  if (audiences.length === 0) return [];
  const s = await getPurchaseSuggestions();
  return audiences
    .map((a) => buildSuggestionNotice(s, a))
    .filter((n): n is SuggestionNotice => !!n)
    .map((n) => ({ type: n.type, icon: n.icon, label: n.label, meta: n.meta, overdue: n.overdue, href }));
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

// Quién puede descartar: Nairoby (su lista son las compras frías) y el admin.
export async function canDiscardSuggestions(userId: string | null, isAdmin: boolean): Promise<boolean> {
  if (isAdmin) return true;
  if (!userId) return false;
  return (await getFinanceLeadId()) === userId;
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
