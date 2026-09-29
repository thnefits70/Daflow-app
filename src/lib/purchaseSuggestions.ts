import { prisma } from "@/lib/prisma";
import { getFinanceLeadId, getInventoryLeadId } from "@/lib/guards";
import { formatPurchaseRequestCode } from "@/lib/purchases";
import { getReadyToBuyPendingProposalIds } from "@/lib/marketProduct";

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
export const URGENT_DAYS = 7;
export const ESCALATE_DAYS = 3;
const WINDOW_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

// Solicitud de compra todavía en camino (no rechazada, no ingresada al Kardex).
const OPEN_PURCHASE_STATUSES = ["PENDING_APPROVAL", "APPROVED", "PAID", "RECEIVED_PENDING_REVIEW"] as const;

export type SuggestionStatus = "urgente" | "pronto" | "no_sale" | "en_compra";

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
};

export type NewProductRow = { proposalId: string; code: string; name: string; photo: string | null; readyToBuyAt: string };

export type PurchaseSuggestions = {
  windowDays: number;
  hot: SuggestionRow[];
  cold: SuggestionRow[];
  newProducts: NewProductRow[];
};

const STATUS_ORDER: Record<SuggestionStatus, number> = { urgente: 0, pronto: 1, en_compra: 2, no_sale: 3 };

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

export async function getPurchaseSuggestions(): Promise<PurchaseSuggestions> {
  const now = new Date();

  // Ventas = pedidos de Dropi que sube Yair (combos ya separados en sus
  // productos por la receta) + ventas externas. Una garantía de solo una
  // pieza sale del stock de repuestos, no cuenta. Los pedidos existen desde
  // 2026-09-21, así que al principio la ventana es más corta que 30 días.
  const firstBatch = await prisma.fulfillmentRequestBatch.findFirst({ orderBy: { requestedAt: "asc" }, select: { requestedAt: true } });
  const windowStart = new Date(Math.max(now.getTime() - WINDOW_DAYS * DAY_MS, firstBatch?.requestedAt.getTime() ?? now.getTime()));
  const windowDays = Math.max(1, (now.getTime() - windowStart.getTime()) / DAY_MS);

  const [balances, balancesBefore, dropiSales, externalSales, openPurchases, readyIds] = await Promise.all([
    latestBalances(),
    latestBalances(new Date(now.getTime() - ESCALATE_DAYS * DAY_MS)),
    prisma.fulfillmentRequestItem.groupBy({
      by: ["catalogItemId"],
      where: { batch: { requestedAt: { gte: windowStart } }, OR: [{ warrantyMode: null }, { warrantyMode: { not: "PIECE" } }] },
      _sum: { quantity: true },
    }),
    prisma.merchandiseOutflowItem.groupBy({
      by: ["catalogItemId"],
      where: { catalogItemId: { not: null }, batch: { reason: "VENTA_EXTERNA", createdAt: { gte: windowStart } } },
      _sum: { quantity: true },
    }),
    prisma.purchaseRequest.findMany({
      where: { status: { in: [...OPEN_PURCHASE_STATUSES] } },
      select: { catalogItemId: true, requestNumber: true, quantity: true },
      orderBy: { createdAt: "desc" },
    }),
    getReadyToBuyPendingProposalIds(),
  ]);

  const sold = new Map<string, number>();
  for (const r of [...dropiSales, ...externalSales]) {
    if (!r.catalogItemId) continue;
    sold.set(r.catalogItemId, (sold.get(r.catalogItemId) ?? 0) + (r._sum.quantity ?? 0));
  }
  const openByItem = new Map<string, { code: string | null; quantity: number }>();
  for (const p of openPurchases) {
    const cur = openByItem.get(p.catalogItemId);
    if (cur) cur.quantity += p.quantity;
    else openByItem.set(p.catalogItemId, { code: p.requestNumber ? formatPurchaseRequestCode(p.requestNumber) : null, quantity: p.quantity });
  }

  // Solo productos que alguna vez estuvieron en INVESTOCK. Los que esperan
  // su ID de Dropi siguen el camino de productos nuevos (Análisis de Mercado).
  const candidateIds = [...balances.entries()].filter(([, bal]) => bal <= COLD_MAX).map(([id]) => id);
  const items = await prisma.purchaseCatalogItem.findMany({
    where: { id: { in: candidateIds }, awaitingDropiId: false },
    select: { id: true, name: true, photos: true, justCode: true },
  });

  const hot: SuggestionRow[] = [];
  const cold: SuggestionRow[] = [];
  for (const item of items) {
    const stock = balances.get(item.id) ?? 0;
    const units = sold.get(item.id) ?? 0;
    const perDay = units / windowDays;
    const daysLeft = perDay > 0 ? Math.max(0, stock) / perDay : null;
    const openPurchase = openByItem.get(item.id) ?? null;
    const status: SuggestionStatus = openPurchase ? "en_compra" : perDay === 0 ? "no_sale" : daysLeft! <= URGENT_DAYS ? "urgente" : "pronto";
    // Ya era urgente hace 3 días (con el stock de ese día y la venta de hoy).
    const before = balancesBefore.get(item.id);
    const escalated = status === "urgente" && before !== undefined && Math.max(0, before) / perDay <= URGENT_DAYS;
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
    };
    (stock <= HOT_MAX ? hot : cold).push(row);
  }

  const proposals = readyIds.length
    ? await prisma.marketProductProposal.findMany({
        where: { id: { in: readyIds } },
        select: { id: true, code: true, productName: true, referenceImageUrl: true, readyToBuyAt: true },
        orderBy: { readyToBuyAt: "asc" },
      })
    : [];

  return {
    windowDays,
    hot: sortRows(hot),
    cold: sortRows(cold),
    newProducts: proposals.map((p) => ({
      proposalId: p.id,
      code: p.code,
      name: p.productName,
      photo: p.referenceImageUrl || null,
      readyToBuyAt: p.readyToBuyAt!.toISOString(),
    })),
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
      meta: `${plural(rows.length, "producto", "productos")} urgente${rows.length === 1 ? "" : "s"} hace ${ESCALATE_DAYS}+ días sin comprar`,
      body: `Hace ${ESCALATE_DAYS} días o más que están urgentes y nadie los compró: ${names}${more}.`,
      overdue: true,
    };
  }
  const rows = audience === "hot" ? s.hot : s.cold;
  const urgent = rows.filter((r) => r.status === "urgente");
  const soon = rows.filter((r) => r.status === "pronto");
  const news = audience === "hot" ? s.newProducts.length : 0;
  if (urgent.length === 0 && soon.length === 0 && news === 0) return null;
  const parts = [
    urgent.length ? plural(urgent.length, "urgente", "urgentes") : null,
    soon.length ? `${soon.length} pronto` : null,
    news ? plural(news, "nuevo", "nuevos") : null,
  ].filter(Boolean);
  const top = urgent.slice(0, 3).map((r) => `${r.name} (${daysText(r.daysLeft)})`).join("; ");
  return {
    audience,
    type: audience === "hot" ? "compras_calientes" : "compras_frias",
    icon: audience === "hot" ? "🔥" : "❄️",
    label: audience === "hot" ? "Compras calientes" : "Compras frías",
    meta: parts.join(" · "),
    body: `${parts.join(" · ")}${top ? `. Primero: ${top}` : ""}.`,
    overdue: urgent.some((r) => r.escalated),
  };
}

export const PURCHASE_SUGGESTIONS_HREF = "/area/workspace?tab=compras&ptab=que-comprar";

// Para el cron de las 8:00: un aviso por persona, con su resumen.
export async function getPurchaseSuggestionPushes(): Promise<{ ownerId: string; type: string; title: string; body: string; url: string }[]> {
  const [s, hotIds, financeLeadId, inventoryLeadId] = await Promise.all([getPurchaseSuggestions(), getHotBuyerIds(), getFinanceLeadId(), getInventoryLeadId()]);
  const out: { ownerId: string; type: string; title: string; body: string; url: string }[] = [];
  const add = (ids: (string | null)[], audience: SuggestionAudience) => {
    const n = buildSuggestionNotice(s, audience);
    if (!n) return;
    for (const id of ids) if (id) out.push({ ownerId: id, type: n.type, title: `DAFLOW · ${n.label}`, body: n.body, url: PURCHASE_SUGGESTIONS_HREF });
  };
  add(hotIds, "hot");
  add([financeLeadId], "cold");
  add([inventoryLeadId], "escalation");
  return out;
}

// Tarjetas de Inicio de esta persona (Jariel, Nairoby o Daniel).
export async function getPurchaseSuggestionPendingItems(userId: string, href: string = PURCHASE_SUGGESTIONS_HREF) {
  const audiences = await getSuggestionAudiencesForUser(userId);
  if (audiences.length === 0) return [];
  const s = await getPurchaseSuggestions();
  return audiences
    .map((a) => buildSuggestionNotice(s, a))
    .filter((n): n is SuggestionNotice => !!n)
    .map((n) => ({ type: n.type, icon: n.icon, label: n.label, meta: n.meta, overdue: n.overdue, href }));
}
