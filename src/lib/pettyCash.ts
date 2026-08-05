import { prisma } from "@/lib/prisma";
import { actorName } from "@/lib/actorName";
import {
  canManagePettyCashPrincipal, canManagePettyCashSecundaria,
  canViewPettyCashPrincipal, canViewPettyCashSecundaria,
} from "@/lib/guards";

// Estados que cuentan como "pago real" para elegir órdenes de pago a las
// que se les puede cargar un flete — mismo criterio que PRICED_STATUSES en
// purchases.ts (no exportado ahí, se repite aquí a propósito).
const ELIGIBLE_ORDER_STATUSES = ["APPROVED", "PAID", "RECEIVED"] as const;

export type PettyCashBoxTypeStr = "PRINCIPAL" | "SECUNDARIA";

export async function getOrCreateBox(type: PettyCashBoxTypeStr) {
  return prisma.pettyCashBox.upsert({ where: { type }, create: { type }, update: {} });
}

async function computeBalance(boxId: string): Promise<number> {
  const entries = await prisma.pettyCashEntry.findMany({
    where: { boxId, archived: false },
    select: { kind: true, amount: true, confirmedAt: true },
  });
  let bal = 0;
  for (const e of entries) {
    if (e.kind === "DESEMBOLSO") bal -= e.amount;
    else if (e.kind === "RECARGA" && e.confirmedAt !== null) bal += e.amount;
  }
  return bal;
}

// Bloquea crear desembolsos/excepciones nuevas mientras esta caja tenga una
// recarga sin confirmar — confirmado 2026-08-05, para que no se pueda seguir
// usando la herramienta hasta que la persona confirme que de verdad recibió
// el dinero declarado.
export async function hasPendingConfirmation(boxId: string): Promise<boolean> {
  const pending = await prisma.pettyCashEntry.findFirst({
    where: { boxId, kind: "RECARGA", confirmedAt: null, archived: false },
  });
  return !!pending;
}

export type PettyCashEntryDTO = {
  id: string;
  requestNumber: number;
  kind: "DESEMBOLSO" | "RECARGA";
  amount: number;
  description: string;
  proofUrl: string | null;
  aiReadAmount: number | null;
  aiMatches: boolean | null;
  linkedGroupId: string | null;
  linkedOrderLabel: string | null;
  manualReason: string | null;
  confirmedAt: string | null;
  confirmedByName: string | null;
  archived: boolean;
  createdByName: string | null;
  createdAt: string;
};

async function orderLabel(groupId: string | null): Promise<string | null> {
  if (!groupId) return null;
  const rows = await prisma.purchaseRequest.findMany({
    where: { groupId },
    select: { catalogItem: { select: { name: true } } },
    take: 3,
  });
  if (rows.length === 0) return `Orden de pago ${groupId.slice(-6)}`;
  const names = rows.map((r) => r.catalogItem.name).join(", ");
  return `Orden de pago — ${names}`;
}

async function toEntryDTO(e: {
  id: string; requestNumber: number; kind: string; amount: number; description: string;
  proofUrl: string | null; aiReadAmount: number | null; aiMatches: boolean | null;
  linkedGroupId: string | null; manualReason: string | null; confirmedAt: Date | null;
  archived: boolean; createdAt: Date; createdBy: { name: string } | null; confirmedBy: { name: string } | null;
}): Promise<PettyCashEntryDTO> {
  return {
    id: e.id,
    requestNumber: e.requestNumber,
    kind: e.kind as "DESEMBOLSO" | "RECARGA",
    amount: e.amount,
    description: e.description,
    proofUrl: e.proofUrl,
    aiReadAmount: e.aiReadAmount,
    aiMatches: e.aiMatches,
    linkedGroupId: e.linkedGroupId,
    linkedOrderLabel: await orderLabel(e.linkedGroupId),
    manualReason: e.manualReason,
    confirmedAt: e.confirmedAt?.toISOString() ?? null,
    confirmedByName: e.confirmedBy ? actorName(e.confirmedBy.name) : null,
    archived: e.archived,
    createdByName: e.createdBy ? actorName(e.createdBy.name) : actorName(null),
    createdAt: e.createdAt.toISOString(),
  };
}

export type PettyCashBoxDTO = {
  type: PettyCashBoxTypeStr;
  minThreshold: number;
  balance: number;
  isLow: boolean;
  blocked: boolean;
  entries: PettyCashEntryDTO[];
  archivedEntries: PettyCashEntryDTO[];
  pendingRecharges: PettyCashEntryDTO[];
};

export async function getPettyCashBoxData(type: PettyCashBoxTypeStr): Promise<PettyCashBoxDTO> {
  const box = await getOrCreateBox(type);
  const rows = await prisma.pettyCashEntry.findMany({
    where: { boxId: box.id },
    include: { createdBy: { select: { name: true } }, confirmedBy: { select: { name: true } } },
    orderBy: { requestNumber: "desc" },
  });

  const active = rows.filter((r) => !r.archived);
  const archived = rows.filter((r) => r.archived);
  const pending = active.filter((r) => r.kind === "RECARGA" && r.confirmedAt === null);
  const balance = await computeBalance(box.id);

  return {
    type,
    minThreshold: box.minThreshold,
    balance,
    isLow: balance <= box.minThreshold,
    blocked: pending.length > 0,
    entries: await Promise.all(active.map(toEntryDTO)),
    archivedEntries: await Promise.all(archived.map(toEntryDTO)),
    pendingRecharges: await Promise.all(pending.map(toEntryDTO)),
  };
}

export type EligiblePaymentOrderDTO = { groupId: string; label: string; shippingCostTotal: number; requestedAt: string };

// Órdenes de pago con flete pendiente — confirmado 2026-08-05: el freno de
// doble pago vive aquí, contra el MISMO campo que ya usa Control de Compras
// para el flete pagado por transferencia (shippingPaidAt), sin importar el
// canal — así nunca se paga dos veces el mismo flete.
export async function getEligiblePaymentOrdersForFreight(): Promise<EligiblePaymentOrderDTO[]> {
  const rows = await prisma.purchaseRequest.findMany({
    where: {
      shippingIncluded: false,
      shippingCostTotal: { not: null },
      shippingPaidAt: null,
      status: { in: [...ELIGIBLE_ORDER_STATUSES] },
    },
    select: { groupId: true, shippingCostTotal: true, requestedAt: true, catalogItem: { select: { name: true } } },
    orderBy: { requestedAt: "desc" },
  });

  const byGroup = new Map<string, EligiblePaymentOrderDTO>();
  for (const r of rows) {
    if (byGroup.has(r.groupId)) continue;
    byGroup.set(r.groupId, {
      groupId: r.groupId,
      label: `${r.catalogItem.name} — flete $${r.shippingCostTotal!.toFixed(2)}`,
      shippingCostTotal: r.shippingCostTotal!,
      requestedAt: r.requestedAt.toISOString(),
    });
  }
  return [...byGroup.values()];
}

export type FreightPaymentCheck =
  | { alreadyPaid: false }
  | { alreadyPaid: true; paidAt: string; paidByName: string; needsException: boolean };

// Confirmado 2026-08-05: si el grupo YA tiene shippingPaidAt (sin importar
// si fue por transferencia o por una entrada anterior de Caja Chica), no se
// puede cargar un segundo comprobante directo — se necesita la excepción
// aprobada por el dueño.
export async function checkFreightAlreadyPaid(groupId: string): Promise<FreightPaymentCheck> {
  const row = await prisma.purchaseRequest.findFirst({
    where: { groupId },
    select: { shippingPaidAt: true, shippingPaidBy: { select: { name: true } } },
  });
  if (!row?.shippingPaidAt) return { alreadyPaid: false };
  return {
    alreadyPaid: true,
    paidAt: row.shippingPaidAt.toISOString(),
    paidByName: actorName(row.shippingPaidBy?.name ?? null),
    needsException: true,
  };
}

export async function hasApprovedException(boxId: string, groupId: string): Promise<boolean> {
  const approved = await prisma.pettyCashFreightException.findFirst({
    where: { boxId, groupId, status: "approved" },
  });
  return !!approved;
}

export async function markGroupFreightPaid(groupId: string, paidById: string | null, proofUrl: string | null) {
  await prisma.purchaseRequest.updateMany({
    where: { groupId },
    data: { shippingPaidAt: new Date(), shippingPaidById: paidById, shippingPaymentProofUrl: proofUrl },
  });
}

// Confirmado 2026-08-05: numeración correlativa por caja, para control y la
// auditoría semestral — incrementado dentro de una transacción para que
// nunca se repita aunque lleguen dos solicitudes al mismo tiempo.
export async function nextRequestNumber(boxId: string): Promise<number> {
  const updated = await prisma.pettyCashBox.update({
    where: { id: boxId },
    data: { lastRequestNumber: { increment: 1 } },
  });
  return updated.lastRequestNumber;
}

export type PendingExceptionDTO = { id: string; groupId: string; label: string; reason: string; requestedByName: string };

async function getPendingExceptions(): Promise<PendingExceptionDTO[]> {
  const rows = await prisma.pettyCashFreightException.findMany({
    where: { status: "pending" },
    include: { requestedBy: { select: { name: true } } },
    orderBy: { createdAt: "asc" },
  });
  return Promise.all(
    rows.map(async (r) => ({
      id: r.id,
      groupId: r.groupId,
      label: (await orderLabel(r.groupId)) ?? r.groupId,
      reason: r.reason,
      requestedByName: actorName(r.requestedBy?.name ?? null),
    }))
  );
}

export type PettyCashViewerData = {
  principal: PettyCashBoxDTO | null;
  secundaria: PettyCashBoxDTO | null;
  canManagePrincipal: boolean;
  canManageSecundaria: boolean;
  canFundPrincipal: boolean;
  canFundSecundaria: boolean;
  eligibleOrders: EligiblePaymentOrderDTO[];
  pendingExceptions: PendingExceptionDTO[];
};

// Un solo punto de ensamblado reusado tanto en "Mi área de trabajo" como en
// la vista de admin — decide qué ve/puede hacer la persona actual con cada
// caja, sin duplicar esta lógica en cada page.tsx.
export async function getPettyCashViewerData(isAdmin: boolean): Promise<PettyCashViewerData> {
  const [canManagePrincipal, canManageSecundaria, canViewPrincipal, canViewSecundaria] = await Promise.all([
    canManagePettyCashPrincipal(),
    canManagePettyCashSecundaria(),
    canViewPettyCashPrincipal(),
    canViewPettyCashSecundaria(),
  ]);

  if (!canViewPrincipal && !canViewSecundaria) {
    return { principal: null, secundaria: null, canManagePrincipal: false, canManageSecundaria: false, canFundPrincipal: false, canFundSecundaria: false, eligibleOrders: [], pendingExceptions: [] };
  }

  const [principal, secundaria, eligibleOrders, pendingExceptions] = await Promise.all([
    canViewPrincipal ? getPettyCashBoxData("PRINCIPAL") : Promise.resolve(null),
    canViewSecundaria ? getPettyCashBoxData("SECUNDARIA") : Promise.resolve(null),
    canManageSecundaria ? getEligiblePaymentOrdersForFreight() : Promise.resolve([]),
    isAdmin ? getPendingExceptions() : Promise.resolve([]),
  ]);

  return {
    principal,
    secundaria,
    canManagePrincipal,
    canManageSecundaria,
    canFundPrincipal: isAdmin,
    canFundSecundaria: isAdmin || canManagePrincipal,
    eligibleOrders,
    pendingExceptions,
  };
}
