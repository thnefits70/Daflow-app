import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canManageSupplierDebtPayments } from "@/lib/guards";
import { notifyOwner } from "@/lib/notifications";

// Confirmado 2026-09-08 (Fase 1, proveedores con crédito): cierra la tanda —
// solo el admin lo hace, y solo él decide cuándo, en respuesta a que el
// proveedor (CHEN) le pida que le paguen. No exige que las transferencias
// sumen exactamente el total (puede ser un pago parcial), pero sí exige al
// menos una transferencia registrada.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await canManageSupplierDebtPayments())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { id } = await params;
  const payment = await prisma.supplierDebtPayment.findUnique({
    where: { id },
    include: { transfers: true, supplier: { select: { name: true } } },
  });
  if (!payment) return NextResponse.json({ error: "No encontrada." }, { status: 404 });
  if (payment.closedAt) return NextResponse.json({ error: "Esta tanda ya está cerrada." }, { status: 409 });
  if (payment.transfers.length === 0) {
    return NextResponse.json({ error: "Agrega al menos una transferencia antes de cerrar la tanda." }, { status: 409 });
  }

  const updated = await prisma.supplierDebtPayment.update({
    where: { id },
    data: { closedAt: new Date() },
  });

  await notifyOwner("admin", {
    title: "Tanda de pago cerrada",
    body: `${payment.code} — ${payment.supplier.name} — $${payment.totalAmount.toFixed(2)}`,
    url: "/admin/dept",
  }).catch(() => null);

  return NextResponse.json(updated);
}
