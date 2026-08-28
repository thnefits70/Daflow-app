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

// Confirmado 2026-08-05: UN código legible por movimiento — "CC-P-003",
// "CC-S-002"... — el número es un solo contador compartido entre las dos
// cajas (nunca dos independientes), la letra dice de cuál caja era.
export function formatPettyCashCode(boxType: PettyCashBoxTypeStr, requestNumber: number): string {
  return `CC-${boxType === "PRINCIPAL" ? "P" : "S"}-${String(requestNumber).padStart(3, "0")}`;
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
  code: string;
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

export async function orderLabel(groupId: string | null): Promise<string | null> {
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
}, boxType: PettyCashBoxTypeStr): Promise<PettyCashEntryDTO> {
  return {
    id: e.id,
    requestNumber: e.requestNumber,
    code: formatPettyCashCode(boxType, e.requestNumber),
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

export type PettyCashPayoutAccountDTO = {
  bankName: string;
  bankAccountType: string;
  bankAccountNumber: string;
  bankAccountHolder: string;
  holderIdType: "RUC" | "CEDULA" | null;
  holderIdNumber: string | null;
  email: string | null;
  phone: string | null;
};

export type PettyCashBoxDTO = {
  type: PettyCashBoxTypeStr;
  minThreshold: number;
  payoutAccount: PettyCashPayoutAccountDTO | null;
  balance: number;
  isLow: boolean;
  blocked: boolean;
  entries: PettyCashEntryDTO[];
  archivedEntries: PettyCashEntryDTO[];
  pendingRecharges: PettyCashEntryDTO[];
};

export async function getPettyCashBoxData(type: PettyCashBoxTypeStr): Promise<PettyCashBoxDTO> {
  const box = await getOrCreateBox(type);
  const [rows, payoutAccount] = await Promise.all([
    prisma.pettyCashEntry.findMany({
      where: { boxId: box.id },
      include: { createdBy: { select: { name: true } }, confirmedBy: { select: { name: true } } },
      orderBy: { requestNumber: "desc" },
    }),
    prisma.pettyCashPayoutAccount.findUnique({ where: { boxId: box.id } }),
  ]);

  const active = rows.filter((r) => !r.archived);
  const archived = rows.filter((r) => r.archived);
  const pending = active.filter((r) => r.kind === "RECARGA" && r.confirmedAt === null);
  const balance = await computeBalance(box.id);

  return {
    type,
    minThreshold: box.minThreshold,
    payoutAccount: payoutAccount && {
      bankName: payoutAccount.bankName,
      bankAccountType: payoutAccount.bankAccountType,
      bankAccountNumber: payoutAccount.bankAccountNumber,
      bankAccountHolder: payoutAccount.bankAccountHolder,
      holderIdType: payoutAccount.holderIdType,
      holderIdNumber: payoutAccount.holderIdNumber,
      email: payoutAccount.email,
      phone: payoutAccount.phone,
    },
    balance,
    isLow: balance <= box.minThreshold,
    blocked: pending.length > 0,
    entries: await Promise.all(active.map((e) => toEntryDTO(e, type))),
    archivedEntries: await Promise.all(archived.map((e) => toEntryDTO(e, type))),
    pendingRecharges: await Promise.all(pending.map((e) => toEntryDTO(e, type))),
  };
}

export type EligiblePaymentOrderDTO = { groupId: string; label: string; shippingCostTotal: number; requestedAt: string };

// Órdenes de pago con flete pendiente — confirmado 2026-08-05: el freno de
// doble pago vive aquí, contra el MISMO campo que ya usa Control de Compras
// para el flete pagado por transferencia (shippingPaidAt), sin importar el
// canal — así nunca se paga dos veces el mismo flete.
//
// Fix confirmado 2026-08-27 (reportado por Bryan, caso real): un mismo
// groupId puede traer VARIOS productos en la misma orden, y cada fila ya
// guarda solo SU fracción del flete (ver effectiveUnitCost/lineShipping en
// purchases.ts). Antes esto tomaba la primera fila que encontraba y
// mostraba esa fracción como si fuera el flete completo de la orden — Bryan
// vio "$4.65" (la parte de un solo producto) en vez de los "$10.00" reales
// que hay que pagarle al transportista por TODA la orden, y lo registró tal
// cual se lo mostró la pantalla. Ahora se suman todas las filas del mismo
// groupId para mostrar y usar el total real.
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

  const byGroup = new Map<string, { groupId: string; total: number; requestedAt: Date; productNames: string[] }>();
  for (const r of rows) {
    const g = byGroup.get(r.groupId);
    if (g) {
      g.total += r.shippingCostTotal!;
      g.productNames.push(r.catalogItem.name);
    } else {
      byGroup.set(r.groupId, { groupId: r.groupId, total: r.shippingCostTotal!, requestedAt: r.requestedAt, productNames: [r.catalogItem.name] });
    }
  }
  return [...byGroup.values()].map((g) => ({
    groupId: g.groupId,
    label: g.productNames.length > 1
      ? `${g.productNames[0]} y ${g.productNames.length - 1} más — flete total $${g.total.toFixed(2)}`
      : `${g.productNames[0]} — flete $${g.total.toFixed(2)}`,
    shippingCostTotal: g.total,
    requestedAt: g.requestedAt.toISOString(),
  }));
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

// Confirmado 2026-08-06: bug real — el monto que de verdad se pagó por caja
// chica nunca se guardaba de vuelta en la solicitud de compra, así que el
// costo por unidad (y todo el historial de precios que se calcula a partir
// de eso) seguía usando el ESTIMADO que se escribió al pedir la compra, no
// lo que en verdad se terminó pagando. `actualAmount` (cuando viene, ej.
// pago por caja chica) reemplaza `shippingCostTotal` en ese momento — para
// transferencia directa (sin monto real distinto) sigue sin tocarse.
//
// Fix confirmado 2026-08-28: cuando el groupId tiene varios productos (ver
// getEligiblePaymentOrdersForFreight más arriba), `actualAmount` es el flete
// REAL de TODA la orden, no el de un solo producto — así que no se le puede
// poner ese mismo número entero a cada fila, o cada producto quedaría con
// muchísimo más flete del que en verdad le tocó, dañando su historial de
// precio. Se reparte proporcional a la cantidad de cada fila, igual que se
// hizo al crear la solicitud (lineShipping en purchases.ts).
export async function markGroupFreightPaid(groupId: string, paidById: string | null, proofUrl: string | null, actualAmount?: number) {
  if (actualAmount === undefined) {
    await prisma.purchaseRequest.updateMany({
      where: { groupId },
      data: { shippingPaidAt: new Date(), shippingPaidById: paidById, shippingPaymentProofUrl: proofUrl },
    });
    return;
  }

  const rows = await prisma.purchaseRequest.findMany({ where: { groupId }, select: { id: true, quantity: true } });
  const totalQty = rows.reduce((s, r) => s + r.quantity, 0);
  await prisma.$transaction(
    rows.map((r) =>
      prisma.purchaseRequest.update({
        where: { id: r.id },
        data: {
          shippingPaidAt: new Date(),
          shippingPaidById: paidById,
          shippingPaymentProofUrl: proofUrl,
          shippingCostTotal: totalQty > 0 ? (actualAmount * r.quantity) / totalQty : actualAmount,
        },
      })
    )
  );
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
