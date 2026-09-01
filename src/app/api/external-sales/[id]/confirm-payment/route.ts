import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canConfirmExternalSalePayment } from "@/lib/guards";
import { notifyFinanceLeadExternalSaleReadyToClose, notifyFinanceLeadExternalSalePendingInvoice } from "@/lib/externalSales";

// Doble confirmación (del lado del cliente) de que el admin de verdad
// recibió el dinero — exclusivo de admin, pedido explícito del usuario.
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!(await canConfirmExternalSalePayment()) || !session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { id } = await params;
  const sale = await prisma.externalSale.findUnique({ where: { id }, select: { paymentProofUrl: true, paymentConfirmedAt: true, deliveredAt: true, code: true } });
  if (!sale) return NextResponse.json({ error: "No encontrado." }, { status: 404 });
  if (!sale.paymentProofUrl) return NextResponse.json({ error: "Todavía no se sube el comprobante." }, { status: 409 });
  if (sale.paymentConfirmedAt) return NextResponse.json({ error: "Ya fue confirmado." }, { status: 409 });

  const updated = await prisma.externalSale.update({
    where: { id },
    data: { paymentConfirmedAt: new Date(), paymentConfirmedById: session.user.role === "admin" ? null : session.user.id },
  });

  await notifyFinanceLeadExternalSalePendingInvoice(sale.code);
  if (sale.deliveredAt) await notifyFinanceLeadExternalSaleReadyToClose(sale.code);
  return NextResponse.json(updated);
}
