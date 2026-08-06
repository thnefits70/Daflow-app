import { prisma } from "@/lib/prisma";

export type SupplierCreditDTO = {
  id: string;
  amount: number;
  reason: string;
  status: "AVAILABLE" | "APPLIED" | "REFUNDED";
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
