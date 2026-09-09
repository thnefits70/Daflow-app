import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { canManageSupplierDebtPayments } from "@/lib/guards";
import { reviewSupplierDebtPayment } from "@/lib/purchaseAi";
import { findDuplicateDebtComprobante } from "@/lib/supplierDebt";

// Confirmado 2026-09-08 (Fase 1, proveedores con crédito): corre la revisión
// de IA sobre una tanda antes de cerrarla — nunca bloquea, solo informa al
// admin. Se puede volver a correr cuantas veces haga falta (por ejemplo,
// después de agregar una transferencia más).
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!(await canManageSupplierDebtPayments()) || !session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { id } = await params;
  const payment = await prisma.supplierDebtPayment.findUnique({
    where: { id },
    include: {
      supplier: { include: { bankAccounts: true } },
      requests: { include: { catalogItem: { select: { name: true } } } },
      transfers: true,
    },
  });
  if (!payment) return NextResponse.json({ error: "No encontrada." }, { status: 404 });

  const duplicateChecks = await Promise.all(
    payment.transfers.map((t) => findDuplicateDebtComprobante(t.comprobanteNumber, payment.id))
  );
  const duplicateComprobantesElsewhere = payment.transfers
    .filter((_, idx) => duplicateChecks[idx])
    .map((t) => t.comprobanteNumber);

  let result;
  try {
    result = await reviewSupplierDebtPayment({
      actorId: session.user.role === "admin" ? null : session.user.id,
      supplierName: payment.supplier.name,
      code: payment.code,
      lines: payment.requests.map((r) => ({
        name: r.catalogItem.name,
        quantity: r.quantity,
        unitCost: r.unitCost,
        totalCost: r.totalCost,
        requestedAt: r.requestedAt.toISOString(),
      })),
      linesTotal: payment.totalAmount,
      transfers: payment.transfers.map((t) => ({
        amount: t.amount,
        comprobanteNumber: t.comprobanteNumber,
        accountDestino: t.accountDestino,
        transferDate: t.transferDate.toISOString(),
      })),
      transfersTotal: payment.transfers.reduce((s, t) => s + t.amount, 0),
      registeredBankAccounts: payment.supplier.bankAccounts.map((b) => ({
        bankName: b.bankName,
        bankAccountNumber: b.bankAccountNumber,
        bankAccountHolder: b.bankAccountHolder,
      })),
      duplicateComprobantesElsewhere,
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "No se pudo completar la revisión con IA." }, { status: 502 });
  }

  const updated = await prisma.supplierDebtPayment.update({
    where: { id },
    data: { aiReviewSummary: result.summary, aiReviewOk: result.ok, aiReviewAt: new Date() },
  });

  return NextResponse.json(updated);
}
