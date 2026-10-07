import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { notifyOwner } from "@/lib/notifications";
import { getMarketingLeadId } from "@/lib/guards";
import { findOpenPurchasesByOthers, formatPurchaseRequestCode, getCatalogItemSupplierComparison, otherOpenPurchaseMessage } from "@/lib/purchases";
import { currentDropiPrices } from "@/lib/dropiPriceChanges";
import { resolveDropiParamsForCatalogItems } from "@/lib/marketProduct";
import { COLD_MAX, COVER_DAYS_AFTER_ARRIVAL, getSalesWindow, getSoldUnitsByItem, HOT_MAX, isStockCoverBlockActive, stockCoverMessage, stockStillCovers, suggestedQuantity, urgentDaysForSupplier } from "@/lib/purchaseSuggestions";
import { computeRepurchase, formatRepurchaseCode, REPURCHASE_VERDICT_LABELS, type RepurchasePriceParams, type RepurchaseVerdict } from "@/lib/repurchasePricing";

// Pedido del usuario 2026-10-06: recompras con aprobación de Bryan Ríos
// (líder de Análisis de Mercado). Toda recompra — compras calientes (Jariel)
// y frías (Nairoby) — necesita una "RC" aprobada ANTES de pedir la compra.
// Quien compra compara el costo de hoy con la última compra y con la
// competencia; Bryan aprueba (puede cambiar solo la cantidad) o rechaza.
// Si Bryan no responde, le sigue saliendo en su Inicio y a quien la envió le
// llega un recordatorio para que hable con él en persona. Con la RC aprobada
// la compra sigue el flujo de siempre (aprobación, pago, recepción, Kardex,
// percha). Ver checkRepurchaseApprovals (se impone en el servidor al crear
// o reenviar una solicitud de compra).

export const APPROVAL_VALID_DAYS = 7;
// Desde cuándo "Bryan no responde": recordatorio a quien la envió.
export const NO_RESPONSE_HOURS = 12;
const DAY_MS = 24 * 60 * 60 * 1000;
export const REPURCHASE_HREF = "/area/workspace?tab=compras&ptab=recompras";

// Productos que ya estuvieron en bodega (tienen Kardex) o que ya se
// compraron en DAFLOW. Los suministros (etiquetas, cintas, fundas…) no se
// venden en Dropi: no tienen competencia que comparar y no pasan por acá.
// Un producto nuevo que todavía espera su ID de Dropi sigue el camino de
// Análisis de Mercado (Proponer → Bryan → Listo para comprar).
export const REPURCHASE_ITEM_WHERE: Prisma.PurchaseCatalogItemWhereInput = {
  awaitingDropiId: false,
  AND: [
    { OR: [{ bodega: null }, { bodega: { not: "MKT_SUMINISTROS" } }] },
    { OR: [{ justCode: null }, { NOT: { justCode: { contains: "-SUM-" } } }] },
    { OR: [{ stockKardexEntries: { some: {} } }, { requests: { some: { status: { not: "REJECTED" } } } }] },
  ],
};

export type RepurchaseItemOption = { id: string; name: string; justCode: string | null; photo: string | null };

export async function searchRepurchaseItems(q: string): Promise<RepurchaseItemOption[]> {
  const term = q.trim();
  if (term.length < 2) return [];
  const items = await prisma.purchaseCatalogItem.findMany({
    where: { ...REPURCHASE_ITEM_WHERE, OR: [{ name: { contains: term, mode: "insensitive" } }, { justCode: { contains: term, mode: "insensitive" } }] },
    select: { id: true, name: true, justCode: true, photos: true },
    orderBy: { name: "asc" },
    take: 15,
  });
  return items.map((i) => ({ id: i.id, name: i.name, justCode: i.justCode, photo: i.photos[0] ?? null }));
}

// ---- Lo que DAFLOW ya sabe del producto ----------------------------------

export type RepurchaseAnalysis = {
  item: RepurchaseItemOption;
  // Compras anteriores por proveedor (el más barato primero), con su último precio.
  suppliers: { supplierId: string; supplierName: string; latest: number; latestDate: string; latestCode: string | null; count: number }[];
  last: { unitCost: number; supplierName: string; date: string; code: string | null } | null;
  // Precio que la asesora B2B confirmó en Dropi (o el que da el sistema hoy).
  publishedDropiPrice: number | null;
  params: RepurchasePriceParams;
  competitor: { id: string | null; price: number | null; source: string } | null;
  stock: number;
  sold: number;
  windowDays: number;
  perDay: number;
  daysLeft: number | null;
  suggestedQty: number | null;
  audience: "HOT" | "COLD";
  // Lo que podría frenar el envío (se avisa antes de llenar nada).
  blocker: string | null;
  // Todavía hay stock (2026-10-07): durante el conteo físico solo aviso;
  // después, para enviarla igual hace falta explicar el motivo a Bryan.
  stockCover: { message: string; needsReason: boolean } | null;
  // RC anteriores del producto (las más nuevas primero).
  history: RepurchaseRow[];
};

async function latestStock(catalogItemId: string): Promise<number> {
  const last = await prisma.stockKardexEntry.findFirst({
    where: { catalogItemId },
    orderBy: [{ occurredAt: "desc" }, { createdAt: "desc" }],
    select: { balanceAfter: true },
  });
  return last?.balanceAfter ?? 0;
}

export async function getRepurchaseAnalysis(catalogItemId: string, userId: string | null): Promise<RepurchaseAnalysis | null> {
  const item = await prisma.purchaseCatalogItem.findFirst({
    where: { id: catalogItemId, ...REPURCHASE_ITEM_WHERE },
    select: { id: true, name: true, justCode: true, photos: true, dropiPriceRef: true },
  });
  if (!item) return null;

  const { windowStart, windowDays } = await getSalesWindow();
  const [comparison, paramsById, dropiNow, soldMap, stock, proposal, lastRcWithCompetitor, lastPurchase, blocker, history] = await Promise.all([
    getCatalogItemSupplierComparison(catalogItemId),
    resolveDropiParamsForCatalogItems([catalogItemId]),
    // Recalcular el precio de Dropi es lo más lento (~2 s): solo si la
    // asesora B2B todavía no confirmó uno.
    item.dropiPriceRef != null ? Promise.resolve(new Map<string, number>()) : currentDropiPrices([catalogItemId]),
    getSoldUnitsByItem(windowStart, [catalogItemId]),
    latestStock(catalogItemId),
    prisma.marketProductProposal.findFirst({
      where: { catalogItemId, competitorPrice: { not: null } },
      select: { competitorId: true, competitorPrice: true, code: true, proposedAt: true },
    }),
    prisma.repurchaseReview.findFirst({
      where: { catalogItemId, competitorPrice: { not: null } },
      orderBy: { requestedAt: "desc" },
      select: { competitorId: true, competitorPrice: true, code: true, requestedAt: true },
    }),
    prisma.purchaseRequest.findFirst({
      where: { catalogItemId, status: { in: ["APPROVED", "PAID", "RECEIVED_PENDING_REVIEW", "RECEIVED"] } },
      orderBy: { createdAt: "desc" },
      select: { supplier: { select: { paymentMode: true } } },
    }),
    findRepurchaseBlocker(catalogItemId, userId),
    listRepurchaseReviews({ catalogItemId, take: 5 }),
  ]);

  const sold = soldMap.get(catalogItemId) ?? 0;
  const perDay = sold / windowDays;
  const daysLeft = perDay > 0 ? Math.max(0, stock) / perDay : null;
  const urgentDays = urgentDaysForSupplier(lastPurchase?.supplier.paymentMode);

  // La competencia más reciente que se anotó: la de la última RC, o la de la propuesta original.
  const competitor = lastRcWithCompetitor
    ? { id: lastRcWithCompetitor.competitorId, price: lastRcWithCompetitor.competitorPrice, source: `${formatRepurchaseCode(lastRcWithCompetitor.code)} (${lastRcWithCompetitor.requestedAt.toISOString()})` }
    : proposal
      ? { id: proposal.competitorId, price: proposal.competitorPrice, source: `propuesta ${proposal.code} (${proposal.proposedAt.toISOString()})` }
      : null;

  const latestOverall = comparison.slice().sort((a, b) => b.latestDate.localeCompare(a.latestDate))[0];
  return {
    item: { id: item.id, name: item.name, justCode: item.justCode, photo: item.photos[0] ?? null },
    suppliers: comparison.map((c) => ({
      supplierId: c.supplierId,
      supplierName: c.supplierName,
      latest: c.latest,
      latestDate: c.latestDate,
      latestCode: c.latestRequestNumber ? formatPurchaseRequestCode(c.latestRequestNumber) : null,
      count: c.count,
    })),
    last: latestOverall
      ? { unitCost: latestOverall.latest, supplierName: latestOverall.supplierName, date: latestOverall.latestDate, code: latestOverall.latestRequestNumber ? formatPurchaseRequestCode(latestOverall.latestRequestNumber) : null }
      : null,
    publishedDropiPrice: item.dropiPriceRef ?? dropiNow.get(catalogItemId) ?? null,
    params: paramsById.get(catalogItemId)!,
    competitor,
    stock,
    sold,
    windowDays,
    perDay,
    daysLeft,
    suggestedQty: suggestedQuantity(perDay, urgentDays, stock),
    audience: stock <= HOT_MAX ? "HOT" : "COLD",
    blocker,
    stockCover: stockStillCovers(stock, perDay, urgentDays)
      ? { message: stockCoverMessage(item.name, stock, daysLeft), needsReason: isStockCoverBlockActive() }
      : null,
    history,
  };
}

// Nadie arranca una RC de un producto que otra persona ya está recomprando
// (mismo freno que las compras abiertas, para que Jariel y Nairoby no
// compren lo mismo sin saberlo). Quien ya tiene una RC abierta de ese
// producto tampoco abre otra.
async function findRepurchaseBlocker(catalogItemId: string, userId: string | null): Promise<string | null> {
  const now = new Date();
  const open = await prisma.repurchaseReview.findFirst({
    where: {
      catalogItemId,
      OR: [{ status: "PENDING_APPROVAL" }, { status: "APPROVED", usedGroupId: null, approvalExpiresAt: { gt: now } }],
    },
    select: { code: true, status: true, requestedById: true, requestedBy: { select: { name: true } } },
  });
  if (open) {
    const who = open.requestedById === userId ? "Tú ya tienes" : `${open.requestedBy?.name ?? "Otra persona"} ya tiene`;
    const what = open.status === "PENDING_APPROVAL" ? "esperando a Bryan" : "aprobada y lista para pedir la compra";
    return `${who} la recompra ${formatRepurchaseCode(open.code)} de este producto ${what}. No hace falta enviar otra.`;
  }
  // Igual que en Compras (2026-09-29): solo quien ya tiene la compra abierta
  // (o la hizo en los últimos 3 días, 2026-10-07) puede pedir más de ese producto.
  const [other] = await findOpenPurchasesByOthers([catalogItemId], userId);
  return other ? otherOpenPurchaseMessage(other) : null;
}

// ---- Listas ------------------------------------------------------------------

export type RepurchaseState = "PENDING_APPROVAL" | "APPROVED" | "EXPIRED" | "REJECTED" | "USED" | "CANCELLED";

export type RepurchaseRow = {
  id: string;
  code: string;
  catalogItemId: string;
  itemName: string;
  justCode: string | null;
  photo: string | null;
  supplierId: string;
  supplierName: string;
  unitCost: number;
  freightTotal: number | null;
  quantity: number;
  approvedQuantity: number | null;
  competitorId: string | null;
  competitorPrice: number | null;
  noCompetitorNote: string | null;
  lastUnitCost: number | null;
  lastSupplierName: string | null;
  lastPurchaseAt: string | null;
  lastCompetitorPrice: number | null;
  lastMarginAtCompetitor: number | null;
  publishedDropiPrice: number | null;
  newDropiPrice: number;
  marginAtCompetitor: number | null;
  maxSupplierCost: number | null;
  marginPercent: number;
  verdict: RepurchaseVerdict;
  verdictLabel: string;
  stockAtRequest: number;
  soldLast30: number;
  daysLeft: number | null;
  audience: "HOT" | "COLD";
  note: string | null;
  state: RepurchaseState;
  requestedById: string | null;
  requestedByName: string | null;
  requestedAt: string;
  reviewedByName: string | null;
  reviewedAt: string | null;
  rejectReason: string | null;
  approvalExpiresAt: string | null;
  usedPurchaseCode: string | null;
  usedAt: string | null;
  // Bryan no respondió todavía después de NO_RESPONSE_HOURS.
  waitingTooLong: boolean;
  // Al enviarla todavía había stock (2026-10-07): Bryan lo ve resaltado.
  stockStillCovered: boolean;
};

const rowSelect = {
  id: true,
  code: true,
  catalogItemId: true,
  catalogItem: { select: { name: true, justCode: true, photos: true } },
  supplierId: true,
  supplier: { select: { name: true, paymentMode: true } },
  unitCost: true,
  freightTotal: true,
  quantity: true,
  approvedQuantity: true,
  competitorId: true,
  competitorPrice: true,
  noCompetitorNote: true,
  lastUnitCost: true,
  lastSupplierName: true,
  lastPurchaseAt: true,
  lastCompetitorPrice: true,
  lastMarginAtCompetitor: true,
  publishedDropiPrice: true,
  newDropiPrice: true,
  marginAtCompetitor: true,
  maxSupplierCost: true,
  marginPercent: true,
  verdict: true,
  stockAtRequest: true,
  soldLast30: true,
  daysLeft: true,
  audience: true,
  note: true,
  status: true,
  requestedById: true,
  requestedBy: { select: { name: true } },
  requestedAt: true,
  reviewedBy: { select: { name: true } },
  reviewedAt: true,
  rejectReason: true,
  approvalExpiresAt: true,
  usedGroupId: true,
  usedAt: true,
} satisfies Prisma.RepurchaseReviewSelect;

type RowRecord = Prisma.RepurchaseReviewGetPayload<{ select: typeof rowSelect }>;

function stateOf(r: { status: string; usedGroupId: string | null; approvalExpiresAt: Date | null }, now: Date): RepurchaseState {
  if (r.status === "APPROVED" && !r.usedGroupId && r.approvalExpiresAt && r.approvalExpiresAt <= now) return "EXPIRED";
  return r.status as RepurchaseState;
}

async function toRows(records: RowRecord[]): Promise<RepurchaseRow[]> {
  const now = new Date();
  const groupIds = records.map((r) => r.usedGroupId).filter((g): g is string => !!g);
  const purchases = groupIds.length
    ? await prisma.purchaseRequest.findMany({ where: { groupId: { in: groupIds } }, distinct: ["groupId"], select: { groupId: true, requestNumber: true } })
    : [];
  const codeByGroup = new Map(purchases.map((p) => [p.groupId, p.requestNumber ? formatPurchaseRequestCode(p.requestNumber) : null]));
  return records.map((r) => {
    const state = stateOf(r, now);
    return {
      id: r.id,
      code: formatRepurchaseCode(r.code),
      catalogItemId: r.catalogItemId,
      itemName: r.catalogItem.name,
      justCode: r.catalogItem.justCode,
      photo: r.catalogItem.photos[0] ?? null,
      supplierId: r.supplierId,
      supplierName: r.supplier.name,
      unitCost: r.unitCost,
      freightTotal: r.freightTotal,
      quantity: r.quantity,
      approvedQuantity: r.approvedQuantity,
      competitorId: r.competitorId,
      competitorPrice: r.competitorPrice,
      noCompetitorNote: r.noCompetitorNote,
      lastUnitCost: r.lastUnitCost,
      lastSupplierName: r.lastSupplierName,
      lastPurchaseAt: r.lastPurchaseAt?.toISOString() ?? null,
      lastCompetitorPrice: r.lastCompetitorPrice,
      lastMarginAtCompetitor: r.lastMarginAtCompetitor,
      publishedDropiPrice: r.publishedDropiPrice,
      newDropiPrice: r.newDropiPrice,
      marginAtCompetitor: r.marginAtCompetitor,
      maxSupplierCost: r.maxSupplierCost,
      marginPercent: r.marginPercent,
      verdict: r.verdict as RepurchaseVerdict,
      verdictLabel: REPURCHASE_VERDICT_LABELS[r.verdict as RepurchaseVerdict] ?? r.verdict,
      stockAtRequest: r.stockAtRequest,
      soldLast30: r.soldLast30,
      daysLeft: r.daysLeft,
      audience: r.audience === "HOT" ? "HOT" : "COLD",
      note: r.note,
      state,
      requestedById: r.requestedById,
      requestedByName: r.requestedBy?.name ?? null,
      requestedAt: r.requestedAt.toISOString(),
      reviewedByName: r.reviewedBy?.name ?? null,
      reviewedAt: r.reviewedAt?.toISOString() ?? null,
      rejectReason: r.rejectReason,
      approvalExpiresAt: r.approvalExpiresAt?.toISOString() ?? null,
      usedPurchaseCode: r.usedGroupId ? codeByGroup.get(r.usedGroupId) ?? null : null,
      usedAt: r.usedAt?.toISOString() ?? null,
      waitingTooLong: state === "PENDING_APPROVAL" && now.getTime() - r.requestedAt.getTime() >= NO_RESPONSE_HOURS * 60 * 60 * 1000,
      stockStillCovered: r.stockAtRequest > COLD_MAX && (r.daysLeft === null || r.daysLeft >= urgentDaysForSupplier(r.supplier.paymentMode) + COVER_DAYS_AFTER_ARRIVAL),
    };
  });
}

export async function listRepurchaseReviews(params: { requestedById?: string; catalogItemId?: string; status?: "PENDING_APPROVAL"; take?: number }): Promise<RepurchaseRow[]> {
  const records = await prisma.repurchaseReview.findMany({
    where: {
      ...(params.requestedById ? { requestedById: params.requestedById } : {}),
      ...(params.catalogItemId ? { catalogItemId: params.catalogItemId } : {}),
      ...(params.status ? { status: params.status } : {}),
    },
    orderBy: { requestedAt: params.status ? "asc" : "desc" },
    take: params.take ?? 60,
    select: rowSelect,
  });
  return toRows(records);
}

// ---- Enviar a Bryan -------------------------------------------------------------

export type CreateRepurchaseInput = {
  catalogItemId: string;
  supplierId: string;
  unitCost: number;
  freightTotal: number | null;
  quantity: number;
  competitorId: string | null;
  competitorPrice: number | null;
  noCompetitorNote: string | null;
  note: string | null;
};

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string; status: number };

export async function createRepurchaseReview(input: CreateRepurchaseInput, userId: string, actorName: string): Promise<Result<{ code: string }>> {
  const analysis = await getRepurchaseAnalysis(input.catalogItemId, userId);
  if (!analysis) return { ok: false, status: 404, error: "Este producto no es una recompra (nunca estuvo en bodega o es un suministro)." };
  if (analysis.blocker) return { ok: false, status: 409, error: analysis.blocker };
  if (analysis.stockCover?.needsReason && (input.note?.trim().length ?? 0) < 10) {
    return { ok: false, status: 400, error: `${analysis.stockCover.message} Si de verdad hace falta (ej. temporada), explica el motivo en la nota para Bryan.` };
  }

  const supplier = await prisma.supplier.findUnique({ where: { id: input.supplierId }, select: { id: true, name: true, type: true } });
  if (!supplier || supplier.type !== "SUPPLIER") return { ok: false, status: 400, error: "Elige el proveedor al que le vas a comprar." };

  const competitorPrice = input.competitorPrice && input.competitorPrice > 0 ? input.competitorPrice : null;
  const noCompetitorNote = input.noCompetitorNote?.trim() || null;
  if (competitorPrice === null && (!noCompetitorNote || noCompetitorNote.length < 5)) {
    return {
      ok: false,
      status: 400,
      error: "Falta el precio de hoy de la competencia. Sin ese precio Bryan no puede saber si conviene. Si de verdad no lo encontraste, marca que no hay competencia y explica por qué.",
    };
  }

  // Nunca se confía en el veredicto que manda el navegador: se recalcula acá.
  const calc = computeRepurchase({ unitCost: input.unitCost, freightTotal: input.freightTotal, quantity: input.quantity, competitorPrice, params: analysis.params });
  if (!calc) return { ok: false, status: 400, error: "Revisa el precio del proveedor y la cantidad." };
  // La última compra (costo ya con flete) contra la competencia de esa vez.
  const lastCalc = analysis.last
    ? computeRepurchase({ unitCost: analysis.last.unitCost, freightTotal: null, quantity: 1, competitorPrice: analysis.competitor?.price ?? null, params: analysis.params })
    : null;

  const created = await prisma.$transaction(async (tx) => {
    // Candado por producto: dos personas mandando la misma recompra a la vez.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"repurchase:" + input.catalogItemId}))`;
    const dup = await tx.repurchaseReview.findFirst({
      where: { catalogItemId: input.catalogItemId, OR: [{ status: "PENDING_APPROVAL" }, { status: "APPROVED", usedGroupId: null, approvalExpiresAt: { gt: new Date() } }] },
      select: { id: true },
    });
    if (dup) return null;
    const last = await tx.repurchaseReview.findFirst({ orderBy: { code: "desc" }, select: { code: true } });
    return tx.repurchaseReview.create({
      data: {
        code: (last?.code ?? 0) + 1,
        catalogItemId: input.catalogItemId,
        supplierId: supplier.id,
        unitCost: input.unitCost,
        freightTotal: input.freightTotal && input.freightTotal > 0 ? input.freightTotal : null,
        quantity: input.quantity,
        competitorId: competitorPrice !== null ? input.competitorId?.trim() || null : null,
        competitorPrice,
        noCompetitorNote: competitorPrice === null ? noCompetitorNote : null,
        lastUnitCost: analysis.last?.unitCost ?? null,
        lastSupplierName: analysis.last?.supplierName ?? null,
        lastPurchaseAt: analysis.last ? new Date(analysis.last.date) : null,
        lastCompetitorPrice: analysis.competitor?.price ?? null,
        lastMarginAtCompetitor: lastCalc?.marginAtCompetitor ?? null,
        publishedDropiPrice: analysis.publishedDropiPrice,
        newDropiPrice: calc.newDropiPrice,
        marginAtCompetitor: calc.marginAtCompetitor,
        maxSupplierCost: calc.maxSupplierCost,
        marginPercent: analysis.params.marginPercent,
        verdict: calc.verdict,
        stockAtRequest: analysis.stock,
        soldLast30: analysis.sold,
        daysLeft: analysis.daysLeft,
        audience: analysis.audience,
        note: input.note?.trim() || null,
        requestedById: userId,
      },
      select: { code: true },
    });
  }, { timeout: 20000, maxWait: 10000 });
  if (!created) return { ok: false, status: 409, error: "Alguien acaba de enviar una recompra de este producto. Recarga la pantalla." };

  const code = formatRepurchaseCode(created.code);
  const bryanId = await getMarketingLeadId();
  if (bryanId) {
    await notifyOwner(bryanId, {
      title: `Recompra por aprobar ${code}`,
      body: `${actorName}: ${analysis.item.name} · ${input.quantity} u. a $${input.unitCost.toFixed(2)} (${supplier.name}). ${REPURCHASE_VERDICT_LABELS[calc.verdict]}.`,
      url: REPURCHASE_HREF,
    }).catch(() => null);
  }
  return { ok: true, code };
}

// ---- Decisión de Bryan -----------------------------------------------------------

export async function decideRepurchaseReview(params: {
  id: string;
  decision: "APPROVE" | "REJECT";
  approvedQuantity: number | null;
  rejectReason: string | null;
  userId: string;
  actorName: string;
}): Promise<Result> {
  const rc = await prisma.repurchaseReview.findUnique({
    where: { id: params.id },
    select: { id: true, code: true, status: true, quantity: true, requestedById: true, catalogItem: { select: { name: true } } },
  });
  if (!rc) return { ok: false, status: 404, error: "No se encontró la recompra." };
  if (rc.status !== "PENDING_APPROVAL") return { ok: false, status: 409, error: "Esta recompra ya se resolvió. Recarga la pantalla." };

  const code = formatRepurchaseCode(rc.code);
  const now = new Date();
  if (params.decision === "REJECT") {
    const reason = params.rejectReason?.trim() ?? "";
    if (reason.length < 5) return { ok: false, status: 400, error: "Escribe por qué la rechazas (mínimo 5 letras), así quien compra sabe qué hacer." };
    const updated = await prisma.repurchaseReview.updateMany({
      where: { id: rc.id, status: "PENDING_APPROVAL" },
      data: { status: "REJECTED", reviewedById: params.userId, reviewedAt: now, rejectReason: reason },
    });
    if (updated.count === 0) return { ok: false, status: 409, error: "Esta recompra ya se resolvió. Recarga la pantalla." };
    if (rc.requestedById) {
      await notifyOwner(rc.requestedById, {
        title: `Recompra rechazada ${code}`,
        body: `${params.actorName} rechazó recomprar ${rc.catalogItem.name}. Motivo: ${reason}`,
        url: REPURCHASE_HREF,
      }).catch(() => null);
    }
    return { ok: true };
  }

  const qty = params.approvedQuantity ?? rc.quantity;
  if (!Number.isInteger(qty) || qty < 1) return { ok: false, status: 400, error: "La cantidad aprobada tiene que ser un número entero mayor a 0." };
  const expires = new Date(now.getTime() + APPROVAL_VALID_DAYS * DAY_MS);
  const updated = await prisma.repurchaseReview.updateMany({
    where: { id: rc.id, status: "PENDING_APPROVAL" },
    data: { status: "APPROVED", reviewedById: params.userId, reviewedAt: now, approvedQuantity: qty, approvalExpiresAt: expires },
  });
  if (updated.count === 0) return { ok: false, status: 409, error: "Esta recompra ya se resolvió. Recarga la pantalla." };
  if (rc.requestedById) {
    await notifyOwner(rc.requestedById, {
      title: `Recompra aprobada ${code}`,
      body: `${params.actorName} aprobó recomprar ${rc.catalogItem.name}: ${qty} u.${qty !== rc.quantity ? ` (pediste ${rc.quantity})` : ""}. Ya puedes pedir la compra — vale ${APPROVAL_VALID_DAYS} días.`,
      url: REPURCHASE_HREF,
    }).catch(() => null);
  }
  return { ok: true };
}

export async function cancelRepurchaseReview(id: string, userId: string): Promise<Result> {
  const updated = await prisma.repurchaseReview.updateMany({
    where: { id, requestedById: userId, status: "PENDING_APPROVAL" },
    data: { status: "CANCELLED", cancelledAt: new Date() },
  });
  if (updated.count === 0) return { ok: false, status: 409, error: "Solo puedes retirar tus recompras que siguen esperando a Bryan." };
  return { ok: true };
}

// ---- Regla al pedir la compra ---------------------------------------------------

type LineForCheck = { catalogItemId: string; quantity: number; unitCost: number };

// Se llama al crear y al reenviar una solicitud de compra. El admin y la vía
// de emergencia (cuando Jariel y Nairoby no están) no pasan por acá. Un
// producto nuevo que Bryan dejó "Listo para comprar" en Análisis de Mercado
// y que todavía no se compró nunca ya tiene su aprobación por ese camino.
// groupId: al reenviar, la RC que ya usó esta misma compra sigue valiendo.
export async function checkRepurchaseApprovals(params: {
  lines: LineForCheck[];
  supplierId: string;
  requesterId: string;
  groupId?: string;
}): Promise<{ ok: true; reviewIds: string[] } | { ok: false; error: string }> {
  const ids = [...new Set(params.lines.map((l) => l.catalogItemId))];
  const needing = await prisma.purchaseCatalogItem.findMany({
    where: {
      id: { in: ids },
      ...REPURCHASE_ITEM_WHERE,
      // Primera compra de un producto que Bryan ya aprobó en Análisis de Mercado.
      NOT: { marketProductProposal: { readyToBuyAt: { not: null }, purchaseRequests: { none: params.groupId ? { groupId: { not: params.groupId } } : {} } } },
    },
    select: { id: true, name: true },
  });
  if (needing.length === 0) return { ok: true, reviewIds: [] };

  const now = new Date();
  const reviews = await prisma.repurchaseReview.findMany({
    where: {
      catalogItemId: { in: needing.map((n) => n.id) },
      requestedById: params.requesterId,
      status: { in: ["APPROVED", "USED"] },
      OR: [{ usedGroupId: null, status: "APPROVED", approvalExpiresAt: { gt: now } }, ...(params.groupId ? [{ usedGroupId: params.groupId }] : [])],
    },
    orderBy: { reviewedAt: "desc" },
    select: { id: true, code: true, catalogItemId: true, supplierId: true, unitCost: true, approvedQuantity: true, supplier: { select: { name: true } } },
  });

  const reviewIds: string[] = [];
  for (const item of needing) {
    const rc = reviews.find((r) => r.catalogItemId === item.id);
    if (!rc) {
      const pending = await prisma.repurchaseReview.findFirst({
        where: { catalogItemId: item.id, requestedById: params.requesterId, status: "PENDING_APPROVAL" },
        select: { code: true },
      });
      return {
        ok: false,
        error: pending
          ? `"${item.name}" es una recompra y su ${formatRepurchaseCode(pending.code)} todavía espera la aprobación de Bryan. Si no responde, habla con él en persona para que la confirme o la rechace.`
          : `"${item.name}" es una recompra: antes de pedirla, analízala en Control de Compras → Recompras y envíala a Bryan. Toda recompra necesita su aprobación para no comprar algo que la competencia vende más barato.`,
      };
    }
    const code = formatRepurchaseCode(rc.code);
    if (rc.supplierId !== params.supplierId) {
      return { ok: false, error: `Bryan aprobó ${code} (${item.name}) con el proveedor ${rc.supplier.name}. Para comprarle a otro proveedor, envía una recompra nueva con ese proveedor.` };
    }
    const lines = params.lines.filter((l) => l.catalogItemId === item.id);
    const qty = lines.reduce((s, l) => s + l.quantity, 0);
    if (rc.approvedQuantity !== null && qty > rc.approvedQuantity) {
      return { ok: false, error: `Bryan aprobó ${rc.approvedQuantity} u. de ${item.name} (${code}) y estás pidiendo ${qty}. Pide como máximo lo aprobado, o envía una recompra nueva.` };
    }
    const over = lines.find((l) => l.unitCost > rc.unitCost + 0.005);
    if (over) {
      return {
        ok: false,
        error: `Bryan aprobó ${item.name} (${code}) a $${rc.unitCost.toFixed(2)} y ahora el precio es $${over.unitCost.toFixed(2)}. Con un precio más alto la cuenta contra la competencia cambia: envía una recompra nueva con el precio de hoy.`,
      };
    }
    reviewIds.push(rc.id);
  }
  return { ok: true, reviewIds };
}

// Marca las RC como usadas por esta compra (dentro de la misma transacción
// que crea las filas de la solicitud).
export async function markRepurchaseReviewsUsed(tx: Prisma.TransactionClient, reviewIds: string[], groupId: string): Promise<void> {
  if (reviewIds.length === 0) return;
  await tx.repurchaseReview.updateMany({
    where: { id: { in: reviewIds } },
    data: { status: "USED", usedGroupId: groupId, usedAt: new Date() },
  });
}

// ---- Inicio y avisos -------------------------------------------------------------

export type RepurchasePendingItem = { type: string; icon: string; label: string; meta: string; overdue: boolean; href: string };

export async function getRepurchasePendingItems(userId: string): Promise<RepurchasePendingItem[]> {
  const now = new Date();
  const noResponseBefore = new Date(now.getTime() - NO_RESPONSE_HOURS * 60 * 60 * 1000);
  const bryanId = await getMarketingLeadId();
  const [pendingAll, mineWaiting, mineReady] = await Promise.all([
    bryanId === userId
      ? prisma.repurchaseReview.findMany({ where: { status: "PENDING_APPROVAL" }, select: { requestedAt: true }, orderBy: { requestedAt: "asc" } })
      : Promise.resolve([]),
    prisma.repurchaseReview.findMany({
      where: { status: "PENDING_APPROVAL", requestedById: userId, requestedAt: { lte: noResponseBefore } },
      select: { code: true, catalogItem: { select: { name: true } } },
      orderBy: { requestedAt: "asc" },
    }),
    prisma.repurchaseReview.findMany({
      where: { status: "APPROVED", usedGroupId: null, requestedById: userId, approvalExpiresAt: { gt: now } },
      select: { code: true, approvalExpiresAt: true, catalogItem: { select: { name: true } } },
      orderBy: { approvalExpiresAt: "asc" },
    }),
  ]);
  const items: RepurchasePendingItem[] = [];
  if (bryanId === userId && pendingAll.length > 0) {
    const late = pendingAll.filter((p) => p.requestedAt <= noResponseBefore).length;
    items.push({
      type: "recompras_por_aprobar",
      icon: "🔁",
      label: "Recompras por aprobar",
      meta: `${pendingAll.length} esperando tu decisión${late ? ` · ${late} hace más de ${NO_RESPONSE_HOURS} h` : ""} — sin tu aprobación no se pueden comprar`,
      overdue: late > 0,
      href: REPURCHASE_HREF,
    });
  }
  if (mineWaiting.length > 0) {
    const names = mineWaiting.slice(0, 3).map((r) => `${formatRepurchaseCode(r.code)} ${r.catalogItem.name}`).join("; ");
    items.push({
      type: "recompras_sin_respuesta",
      icon: "🗣️",
      label: "Bryan no ha respondido tus recompras",
      meta: `${names}${mineWaiting.length > 3 ? ` y ${mineWaiting.length - 3} más` : ""} — habla con él en persona para que las confirme o las rechace`,
      overdue: true,
      href: REPURCHASE_HREF,
    });
  }
  if (mineReady.length > 0) {
    const soon = mineReady.filter((r) => r.approvalExpiresAt!.getTime() - now.getTime() <= 2 * DAY_MS).length;
    items.push({
      type: "recompras_listas",
      icon: "🛒",
      label: "Recompras aprobadas — pide la compra",
      meta: `${mineReady.length} lista${mineReady.length === 1 ? "" : "s"} para pedir${soon ? ` · ${soon} vence${soon === 1 ? "" : "n"} en 2 días o menos` : ""}`,
      overdue: soon > 0,
      href: REPURCHASE_HREF,
    });
  }
  return items;
}

// Aviso de las 8:00: a Bryan lo que espera su decisión, y a quien envió una
// RC que Bryan no respondió, que hable con él en persona.
export async function getRepurchaseReminderPushes(): Promise<{ ownerId: string; title: string; body: string; url: string }[]> {
  const now = new Date();
  const noResponseBefore = new Date(now.getTime() - NO_RESPONSE_HOURS * 60 * 60 * 1000);
  const [bryanId, pending] = await Promise.all([
    getMarketingLeadId(),
    prisma.repurchaseReview.findMany({
      where: { status: "PENDING_APPROVAL" },
      select: { code: true, requestedAt: true, requestedById: true, catalogItem: { select: { name: true } } },
      orderBy: { requestedAt: "asc" },
    }),
  ]);
  const out: { ownerId: string; title: string; body: string; url: string }[] = [];
  if (pending.length === 0) return out;
  if (bryanId) {
    out.push({
      ownerId: bryanId,
      title: "DAFLOW · Recompras por aprobar",
      body: `${pending.length} recompra${pending.length === 1 ? "" : "s"} esperando tu decisión. Sin tu aprobación no se pueden comprar.`,
      url: REPURCHASE_HREF,
    });
  }
  const late = pending.filter((p) => p.requestedAt <= noResponseBefore && p.requestedById);
  const byRequester = new Map<string, string[]>();
  for (const p of late) byRequester.set(p.requestedById!, [...(byRequester.get(p.requestedById!) ?? []), `${formatRepurchaseCode(p.code)} ${p.catalogItem.name}`]);
  for (const [ownerId, list] of byRequester) {
    out.push({
      ownerId,
      title: "DAFLOW · Bryan no ha respondido tu recompra",
      body: `${list.slice(0, 3).join("; ")}${list.length > 3 ? ` y ${list.length - 3} más` : ""}. Habla con Bryan en persona para que la confirme o la rechace.`,
      url: REPURCHASE_HREF,
    });
  }
  return out;
}

// RC abiertas (esperando a Bryan o aprobadas sin usar) por producto, para
// mostrarlas en cada fila de "Qué comprar".
export async function getOpenRepurchaseByItem(): Promise<Record<string, { code: string; state: "PENDING_APPROVAL" | "APPROVED"; byName: string | null }>> {
  const rows = await prisma.repurchaseReview.findMany({
    where: { OR: [{ status: "PENDING_APPROVAL" }, { status: "APPROVED", usedGroupId: null, approvalExpiresAt: { gt: new Date() } }] },
    select: { catalogItemId: true, code: true, status: true, requestedBy: { select: { name: true } } },
  });
  return Object.fromEntries(
    rows.map((r) => [r.catalogItemId, { code: formatRepurchaseCode(r.code), state: r.status as "PENDING_APPROVAL" | "APPROVED", byName: r.requestedBy?.name ?? null }]),
  );
}
