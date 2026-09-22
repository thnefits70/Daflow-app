import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canConfirmExternalSalePayment } from "@/lib/guards";
import { notifyFinanceLeadExternalSaleReadyToClose, notifyFinanceLeadExternalSalePendingInvoice, isFreightPayable, notifyPettyCashFreightPayable } from "@/lib/externalSales";

// Doble confirmación (del lado del cliente) de que el admin de verdad
// recibió el dinero — exclusivo de admin, pedido explícito del usuario.
//
// Confirmado 2026-09-18: bloqueado mientras la IA no haya verificado que el
// comprobante coincide con lo esperado (paymentProofAiMatches true) — salvo
// que ya exista una explicación del asesor (o admin) sobre por qué el monto
// no coincide, ver /payment-amount-note. Esta ruta solo confirma que llegó
// el dinero, no vuelve a pedir la explicación.
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!(await canConfirmExternalSalePayment()) || !session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { id } = await params;
  const sale = await prisma.externalSale.findUnique({
    where: { id },
    select: {
      paymentProofUrl: true, paymentConfirmedAt: true, deliveredAt: true, code: true, paymentProofAiMatches: true, paymentOverrideNote: true,
      pickupPersonName: true, isContraEntrega: true, freightCost: true, clientReceivedAt: true, freightPaidAt: true, deletedAt: true,
    },
  });
  if (!sale) return NextResponse.json({ error: "No encontrado." }, { status: 404 });
  if (!sale.paymentProofUrl) return NextResponse.json({ error: "Todavía no se sube el comprobante." }, { status: 409 });
  if (sale.paymentConfirmedAt) return NextResponse.json({ error: "Ya fue confirmado." }, { status: 409 });
  if (sale.paymentProofAiMatches !== true && !sale.paymentOverrideNote) {
    return NextResponse.json({ error: "La IA no verificó que el comprobante coincida y todavía no hay una explicación — pídele al asesor que la agregue." }, { status: 409 });
  }

  const updated = await prisma.externalSale.update({
    where: { id },
    data: { paymentConfirmedAt: new Date(), paymentConfirmedById: session.user.role === "admin" ? null : session.user.id },
  });

  await notifyFinanceLeadExternalSalePendingInvoice(sale.code);
  if (sale.deliveredAt) await notifyFinanceLeadExternalSaleReadyToClose(sale.code);
  // Si el asesor ya había confirmado que el cliente recibió el pedido antes
  // de que llegara el pago, recién ahora el flete queda listo para pagar.
  if (isFreightPayable({ ...sale, paymentConfirmedAt: updated.paymentConfirmedAt })) {
    await notifyPettyCashFreightPayable({ code: sale.code, pickupPersonName: sale.pickupPersonName, freightCost: sale.freightCost! });
  }
  return NextResponse.json(updated);
}
