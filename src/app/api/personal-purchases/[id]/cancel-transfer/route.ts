import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { resolveFirstPayoutMonth } from "@/lib/payroll";
import { addMonthsToMonthStr } from "@/lib/payrollCalc";
import { sendPushToOwner } from "@/lib/webPush";

// Confirmado 2026-08-21: pedido de Yair — si eligió transferencia por error
// (o simplemente cambia de opinión) antes de subir el comprobante, puede
// cancelarla y pasarse a rol de pago sin pasar de nuevo por
// PENDING_PAYMENT_METHOD. Solo válido mientras no subió comprobante
// (status === PENDING_TRANSFER_PROOF); una vez subido ya está en revisión
// y no se puede tocar acá. Misma lógica que la rama PAYROLL de
// choose-payment-method — firstPayoutMonth solo se calcula acá, nunca antes.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session || session.user.role === "admin") return NextResponse.json({ error: "No autorizado." }, { status: 401 });

  const { id } = await params;

  const order = await prisma.personalPurchaseOrder.findUnique({ where: { id } });
  if (!order) return NextResponse.json({ error: "No encontrado." }, { status: 404 });
  if (order.employeeId !== session.user.id) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  if (order.status !== "PENDING_TRANSFER_PROOF") return NextResponse.json({ error: "Ya no se puede cambiar." }, { status: 409 });

  const naturalFirstMonth = addMonthsToMonthStr(order.eventMonth, 1);
  const firstPayoutMonth = await resolveFirstPayoutMonth(naturalFirstMonth);

  const updated = await prisma.personalPurchaseOrder.update({
    where: { id },
    data: { paymentMethod: "PAYROLL", status: "APPROVED", firstPayoutMonth, transferDeadlineAt: null },
  });

  const cuotaText = order.installments > 1 ? ` en ${order.installments} cuotas` : "";
  await sendPushToOwner(session.user.id, {
    title: "✅ Tu compra personal quedó en rol",
    body: `Total $${order.totalAmount?.toFixed(2)}${cuotaText} — se va a descontar de tu rol a partir de ${firstPayoutMonth}.`,
    url: "/area/compras-personales",
  }).catch(() => null);

  return NextResponse.json(updated);
}
