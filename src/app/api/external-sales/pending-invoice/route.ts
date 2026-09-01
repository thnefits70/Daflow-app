import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canInvoiceExternalSale } from "@/lib/guards";

// Pago ya confirmado, todavía sin factura — obligatoria en pago anticipado
// (bloquea a Daniel), opcional en contra entrega (Marcos, solo si el
// cliente la pidió, no bloquea nada río abajo).
export async function GET() {
  if (!(await canInvoiceExternalSale())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  const sales = await prisma.externalSale.findMany({
    where: { paymentConfirmedAt: { not: null }, invoiceUploadedAt: null, deletedAt: null },
    include: { catalogItem: { select: { name: true, justCode: true } }, advisor: { select: { name: true } }, client: true },
    orderBy: { paymentConfirmedAt: "asc" },
  });
  return NextResponse.json(sales);
}
