import { prisma } from "@/lib/prisma";

export type SupplierCreditDTO = {
  id: string;
  amount: number;
  reason: string;
  status: "AVAILABLE" | "RESERVED" | "APPLIED" | "REFUNDED" | "CANCELLED";
  createdAt: string;
};

// Confirmado 2026-08-06: solo los créditos AVAILABLE cuentan para el saldo
// que se ofrece aplicar en la siguiente compra — los APPLIED/REFUNDED ya se
// resolvieron, quedan solo como historial.
export async function getSupplierCreditBalance(supplierId: string): Promise<number> {
  const credits = await prisma.supplierCredit.findMany({ where: { supplierId, status: "AVAILABLE" }, select: { amount: true } });
  return credits.reduce((s, c) => s + c.amount, 0);
}

export async function getAvailableCreditsForSupplier(supplierId: string): Promise<SupplierCreditDTO[]> {
  const credits = await prisma.supplierCredit.findMany({
    where: { supplierId, status: "AVAILABLE" },
    orderBy: { createdAt: "asc" },
  });
  return credits.map((c) => ({ id: c.id, amount: c.amount, reason: c.reason, status: c.status, createdAt: c.createdAt.toISOString() }));
}

// Confirmado 2026-08-12: pedido explícito del usuario — al solicitar una
// compra, los créditos que se marquen quedan RESERVADOS a esa solicitud de
// una vez (nadie más los puede usar mientras tanto). Si la suma supera el
// total de la solicitud (caso excepcional — en la práctica el crédito
// siempre es menor a la compra), se rechaza: ese caso requiere que el
// admin lo revise manualmente, no se resuelve solo.
export type ReserveCreditsResult =
  | { ok: true; reservedTotal: number }
  | { ok: false; error: string; status: number };

export async function reserveCreditsForGroup(params: {
  creditIds: string[];
  supplierId: string;
  groupId: string;
  groupTotal: number;
}): Promise<ReserveCreditsResult> {
  const { creditIds, supplierId, groupId, groupTotal } = params;
  if (creditIds.length === 0) return { ok: true, reservedTotal: 0 };

  const credits = await prisma.supplierCredit.findMany({
    where: { id: { in: creditIds }, supplierId, status: "AVAILABLE" },
  });
  if (credits.length !== creditIds.length) {
    return { ok: false, error: "Uno o más créditos ya no están disponibles — vuelve a revisar antes de enviar.", status: 409 };
  }
  const reservedTotal = credits.reduce((s, c) => s + c.amount, 0);
  if (reservedTotal > groupTotal) {
    return {
      ok: false,
      error: `El crédito seleccionado ($${reservedTotal.toFixed(2)}) es mayor al total de esta solicitud ($${groupTotal.toFixed(2)}) — avísale al admin para que lo revise, en vez de aplicarlo aquí.`,
      status: 409,
    };
  }

  await prisma.supplierCredit.updateMany({
    where: { id: { in: creditIds }, status: "AVAILABLE" },
    data: { status: "RESERVED", reservedForGroupId: groupId, reservedAt: new Date() },
  });
  return { ok: true, reservedTotal };
}

// Confirmado 2026-08-12: al pagar, Finanzas necesita ver el crédito que ya
// quedó anclado a esta solicitud desde que se pidió (reserveCreditsForGroup)
// — se muestra como ya aplicado, sin poder destildarlo, para no confundirlo
// con crédito adicional del mismo proveedor que sí se puede elegir ahí mismo.
export async function getReservedCreditsForGroup(groupId: string): Promise<SupplierCreditDTO[]> {
  const credits = await prisma.supplierCredit.findMany({
    where: { reservedForGroupId: groupId, status: "RESERVED" },
    orderBy: { createdAt: "asc" },
  });
  return credits.map((c) => ({ id: c.id, amount: c.amount, reason: c.reason, status: c.status, createdAt: c.createdAt.toISOString() }));
}

// Confirmado 2026-09-04: pedido explícito del usuario (Bryan) — una vez
// pagada la solicitud, el crédito que se usó pasa de RESERVED a APPLIED (ver
// pay/route.ts) y deja de aparecer en getReservedCreditsForGroup. Sin esto,
// las pantallas de solo lectura (Historial de aprobación, Auditoría) siguen
// mostrando el total crudo de la cotización sin restar el crédito ya usado,
// aunque de verdad se haya transferido menos.
export async function getAppliedCreditsForGroup(groupId: string): Promise<SupplierCreditDTO[]> {
  const credits = await prisma.supplierCredit.findMany({
    where: { appliedToGroupId: groupId, status: "APPLIED" },
    orderBy: { createdAt: "asc" },
  });
  return credits.map((c) => ({ id: c.id, amount: c.amount, reason: c.reason, status: c.status, createdAt: c.createdAt.toISOString() }));
}

// Confirmado 2026-08-12: si la solicitud se rechaza por completo, cualquier
// crédito que se le hubiera reservado vuelve a quedar libre de inmediato.
export async function releaseCreditsForGroup(groupId: string): Promise<void> {
  await prisma.supplierCredit.updateMany({
    where: { reservedForGroupId: groupId, status: "RESERVED" },
    data: { status: "AVAILABLE", reservedForGroupId: null, reservedAt: null },
  });
}

export type PendingCreditDTO = {
  id: string;
  amount: number;
  reason: string;
  status: "AVAILABLE" | "RESERVED";
  createdAt: string;
  proofUrl: string | null;
  proofName: string | null;
  isManual: boolean;
  supplier: { id: string; name: string };
  createdBy: { name: string } | null;
  reservedForCode: string | null;
};

// Confirmado 2026-08-12: pedido explícito del usuario — una sola pantalla
// con TODO el crédito vivo de la empresa (de cualquier proveedor), venga de
// un reporte urgente resuelto o cargado a mano. Desaparece de acá en cuanto
// se aplica de verdad (status pasa a APPLIED al pagar).
export async function getAllPendingCredits(): Promise<PendingCreditDTO[]> {
  const credits = await prisma.supplierCredit.findMany({
    where: { status: { in: ["AVAILABLE", "RESERVED"] } },
    orderBy: { createdAt: "desc" },
    include: { supplier: { select: { id: true, name: true } }, createdBy: { select: { name: true } } },
  });

  const groupIds = [...new Set(credits.map((c) => c.reservedForGroupId).filter((x): x is string => !!x))];
  const codeByGroupId = new Map<string, number | null>();
  if (groupIds.length > 0) {
    const rows = await prisma.purchaseRequest.findMany({
      where: { groupId: { in: groupIds } },
      select: { groupId: true, requestNumber: true },
      distinct: ["groupId"],
    });
    rows.forEach((r) => codeByGroupId.set(r.groupId, r.requestNumber));
  }

  return credits.map((c) => ({
    id: c.id,
    amount: c.amount,
    reason: c.reason,
    status: c.status as "AVAILABLE" | "RESERVED",
    createdAt: c.createdAt.toISOString(),
    proofUrl: c.proofUrl,
    proofName: c.proofName,
    isManual: !c.urgentResolutionId,
    supplier: c.supplier,
    createdBy: c.createdBy,
    reservedForCode:
      c.reservedForGroupId && codeByGroupId.get(c.reservedForGroupId)
        ? `SC-${String(codeByGroupId.get(c.reservedForGroupId)).padStart(3, "0")}`
        : null,
  }));
}

export type SupplierExchangeCreditTotal = {
  supplierId: string;
  supplierName: string;
  total: number;
  credits: { id: string; amount: number; batchCode: string; itemName: string; createdAt: string }[];
};

// Confirmado 2026-08-27, pedido explícito del usuario: total de crédito YA
// CONFIRMADO (el proveedor ya aceptó darlo) por proveedor, sumando entre
// TODOS los lotes separados de "Cambio con proveedor" que tenga ese
// proveedor — sin mezclar los lotes entre sí (cada uno sigue siendo su
// propia tarjeta), solo el total con el detalle de qué lote aportó cada
// parte. Se identifica un crédito de este flujo por tener outflowItemId (a
// diferencia de los créditos manuales o de reportes urgentes). Cuenta
// cualquier estado (no solo AVAILABLE) porque lo que importa acá es "el
// proveedor ya lo confirmó", no si todavía se puede gastar.
export async function getConfirmedSupplierExchangeCreditTotals(): Promise<SupplierExchangeCreditTotal[]> {
  const credits = await prisma.supplierCredit.findMany({
    where: { outflowItemId: { not: null } },
    include: {
      supplier: { select: { id: true, name: true } },
      outflowItem: { select: { declaredName: true, catalogItem: { select: { name: true } }, batch: { select: { code: true } } } },
    },
    orderBy: { createdAt: "asc" },
  });

  const bySupplier = new Map<string, SupplierExchangeCreditTotal>();
  for (const c of credits) {
    if (!c.outflowItem) continue;
    const entry = bySupplier.get(c.supplierId) ?? { supplierId: c.supplierId, supplierName: c.supplier.name, total: 0, credits: [] };
    entry.total += c.amount;
    entry.credits.push({
      id: c.id,
      amount: c.amount,
      batchCode: c.outflowItem.batch.code,
      itemName: c.outflowItem.catalogItem?.name ?? c.outflowItem.declaredName,
      createdAt: c.createdAt.toISOString(),
    });
    bySupplier.set(c.supplierId, entry);
  }
  return [...bySupplier.values()].sort((a, b) => b.total - a.total);
}

export type StaleSupplierCreditPush = { ownerId: string; title: string; body: string; url: string };

// Confirmado 2026-08-06: si un crédito AVAILABLE lleva más de 30 días sin
// aplicarse a una compra nueva, se avisa a admin + Nairoby (Finanzas) +
// quien tenga la delegación de Compras (hoy Bryan, vía canManagePurchases)
// — mismo espíritu que getStalePurchaseRequestPushes: se vuelve a avisar
// cada día mientras siga sin recuperarse, no solo una vez.
export async function getStaleSupplierCreditPushes(): Promise<StaleSupplierCreditPush[]> {
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const [staleCredits, purchaseLeaders] = await Promise.all([
    prisma.supplierCredit.findMany({
      where: { status: "AVAILABLE", createdAt: { lt: cutoff } },
      include: { supplier: { select: { name: true } } },
    }),
    prisma.user.findMany({
      where: { isActive: true, OR: [{ canManagePurchases: true }, { isLeader: true, leadsDept: { code: { in: ["COM", "FIN"] } } }] },
      select: { id: true },
    }),
  ]);
  if (staleCredits.length === 0) return [];

  const targets = new Set<string>(["admin", ...purchaseLeaders.map((u) => u.id)]);
  const pushes: StaleSupplierCreditPush[] = [];
  for (const c of staleCredits) {
    const days = Math.floor((Date.now() - c.createdAt.getTime()) / 86400000);
    for (const ownerId of targets) {
      pushes.push({
        ownerId,
        title: "💰 Crédito con proveedor sin recuperar hace más de 1 mes",
        body: `${c.supplier.name} — $${c.amount.toFixed(2)} · ${c.reason} · ${days} días`,
        url: ownerId === "admin" ? "/admin" : "/area/workspace",
      });
    }
  }
  return pushes;
}
