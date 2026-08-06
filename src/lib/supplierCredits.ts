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
