import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canManageSupplierDebtPayments } from "@/lib/guards";
import { getSupplierDebtPendingItems, getSupplierDebtDisputedItems } from "@/lib/supplierDebt";

// Confirmado 2026-09-08 (Fase 1, proveedores con crédito): panorama completo
// de un proveedor de crédito (hoy solo CHEN) — saldo actual, lo pendiente
// (ya confirmado, no pagado), lo en disputa (visible pero no cuenta), y las
// tandas ya cerradas. Admin-only, ver canManageSupplierDebtPayments.
export async function GET(req: NextRequest, { params }: { params: Promise<{ supplierId: string }> }) {
  if (!(await canManageSupplierDebtPayments())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { supplierId } = await params;
  const supplier = await prisma.supplier.findUnique({
    where: { id: supplierId },
    include: { bankAccounts: true },
  });
  if (!supplier) return NextResponse.json({ error: "No encontrado." }, { status: 404 });
  if (supplier.paymentMode !== "CREDITO") {
    return NextResponse.json({ error: "Este proveedor no es de crédito." }, { status: 409 });
  }

  const [pendingItems, disputedItems, openPayments, closedPayments] = await Promise.all([
    getSupplierDebtPendingItems(supplierId),
    getSupplierDebtDisputedItems(supplierId),
    prisma.supplierDebtPayment.findMany({
      where: { supplierId, closedAt: null },
      include: {
        requests: { include: { catalogItem: { select: { name: true } } } },
        transfers: true,
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.supplierDebtPayment.findMany({
      where: { supplierId, closedAt: { not: null } },
      include: {
        requests: { include: { catalogItem: { select: { name: true } } } },
        transfers: true,
      },
      orderBy: { closedAt: "desc" },
      take: 30,
    }),
  ]);

  const balance = pendingItems.reduce((s, i) => s + i.totalCost, 0);

  return NextResponse.json({
    supplier: {
      id: supplier.id,
      name: supplier.name,
      paymentMode: supplier.paymentMode,
      hasPublicLink: !!supplier.publicLedgerTokenHash,
      publicLedgerTokenCreatedAt: supplier.publicLedgerTokenCreatedAt,
      bankAccounts: supplier.bankAccounts.map((b) => ({
        id: b.id,
        bankName: b.bankName,
        bankAccountNumber: b.bankAccountNumber,
        bankAccountHolder: b.bankAccountHolder,
      })),
    },
    balance,
    pendingItems,
    disputedItems,
    openPayments,
    closedPayments,
  });
}
