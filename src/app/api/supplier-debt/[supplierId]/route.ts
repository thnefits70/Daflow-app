import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canManageSupplierDebtPayments } from "@/lib/guards";
import {
  getSupplierDebtPendingItems,
  getSupplierDebtPendingExcessItems,
  getSupplierDebtDisputedItems,
  getSupplierDebtInTransitItems,
  supplierDebtReportsInclude,
  appliedTandaCreditDeduction,
} from "@/lib/supplierDebt";

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

  const [pendingItems, pendingExcessItems, disputedItems, inTransitItems, openPayments, closedPayments] = await Promise.all([
    getSupplierDebtPendingItems(supplierId),
    getSupplierDebtPendingExcessItems(supplierId),
    getSupplierDebtDisputedItems(supplierId),
    getSupplierDebtInTransitItems(supplierId),
    prisma.supplierDebtPayment.findMany({
      where: { supplierId, closedAt: null },
      include: {
        requests: { include: { catalogItem: { select: { name: true } }, ...supplierDebtReportsInclude } },
        // Confirmado 2026-09-21: excedentes incluidos en esta tanda, cada
        // uno anclado a su propia solicitud (request.requestNumber).
        excessReports: { include: { request: { select: { requestNumber: true, unitCost: true, catalogItem: { select: { name: true } } } } } },
        transfers: true,
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.supplierDebtPayment.findMany({
      where: { supplierId, closedAt: { not: null } },
      include: {
        requests: { include: { catalogItem: { select: { name: true } }, ...supplierDebtReportsInclude } },
        excessReports: { include: { request: { select: { requestNumber: true, unitCost: true, catalogItem: { select: { name: true } } } } } },
        transfers: true,
      },
      orderBy: { closedAt: "desc" },
      take: 30,
    }),
  ]);

  const balance =
    pendingItems.reduce((s, i) => s + i.totalCost, 0) + pendingExcessItems.reduce((s, i) => s + i.amount, 0);

  // Confirmado 2026-09-21: excessReports no guarda un monto propio (se
  // calcula del unitCost de su solicitud ancla, igual que
  // getSupplierDebtPendingExcessItems) — se agrega acá para que la tanda
  // muestre el mismo monto exacto que se le pagó.
  // Confirmado 2026-09-22: cada pedido de la tanda se muestra NETO del
  // descuento aceptado por el proveedor (ver appliedTandaCreditDeduction),
  // así las filas suman exactamente el total pagado. urgentReports se quita
  // de la respuesta, solo hacía falta para este cálculo.
  function withExcessAmount<
    T extends {
      id: string;
      excessReports: { excessQty: number; request: { unitCost: number } }[];
      requests: { totalCost: number; urgentReports: Parameters<typeof appliedTandaCreditDeduction>[0] }[];
    },
  >(payment: T) {
    return {
      ...payment,
      requests: payment.requests.map(({ urgentReports, ...r }) => {
        const creditDeduction = appliedTandaCreditDeduction(urgentReports, payment.id);
        return { ...r, grossCost: r.totalCost, creditDeduction, totalCost: Math.round((r.totalCost - creditDeduction) * 100) / 100 };
      }),
      excessReports: payment.excessReports.map((r) => ({ ...r, amount: Math.round(r.request.unitCost * r.excessQty * 100) / 100 })),
    };
  }
  const openPaymentsOut = openPayments.map(withExcessAmount);
  const closedPaymentsOut = closedPayments.map(withExcessAmount);

  return NextResponse.json({
    supplier: {
      id: supplier.id,
      name: supplier.name,
      paymentMode: supplier.paymentMode,
      hasPublicLink: !!supplier.publicLedgerToken || !!supplier.publicLedgerTokenHash,
      // Confirmado 2026-09-15: solo existe para un enlace generado a partir
      // de este cambio — uno generado antes (hash-only, ya irrecuperable)
      // sigue funcionando pero no se puede volver a mostrar aquí.
      publicLedgerToken: supplier.publicLedgerToken,
      publicLedgerTokenCreatedAt: supplier.publicLedgerTokenCreatedAt,
      // Confirmado 2026-09-17: segundo enlace, solo "lo que falta enviar",
      // pensado para que el proveedor se lo pase a su propio equipo.
      publicShippingToken: supplier.publicShippingToken,
      publicShippingTokenCreatedAt: supplier.publicShippingTokenCreatedAt,
      bankAccounts: supplier.bankAccounts.map((b) => ({
        id: b.id,
        bankName: b.bankName,
        bankAccountNumber: b.bankAccountNumber,
        bankAccountHolder: b.bankAccountHolder,
      })),
    },
    balance,
    pendingItems,
    pendingExcessItems,
    disputedItems,
    inTransitItems,
    openPayments: openPaymentsOut,
    closedPayments: closedPaymentsOut,
  });
}
