import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canInvoiceExternalSale } from "@/lib/guards";
import { notifyInventoryLeadExternalSaleInvoiced } from "@/lib/externalSales";

const schema = z.object({ invoiceUrl: z.string().url(), invoiceName: z.string().trim().optional() });

// Nairoby sube la factura con los datos que declaró el asesor — obligatoria
// en pago anticipado (recién ahí pasa a Daniel), opcional en contra entrega
// (solo si el cliente final la pidió). Siempre requiere que el pago ya esté
// confirmado por admin.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!(await canInvoiceExternalSale()) || !session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { id } = await params;
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });

  const sale = await prisma.externalSale.findUnique({
    where: { id },
    select: { paymentConfirmedAt: true, invoiceUploadedAt: true, isContraEntrega: true, code: true },
  });
  if (!sale) return NextResponse.json({ error: "No encontrado." }, { status: 404 });
  if (!sale.paymentConfirmedAt) return NextResponse.json({ error: "Todavía no se confirma que llegó el dinero." }, { status: 409 });
  if (sale.invoiceUploadedAt) return NextResponse.json({ error: "Ya fue facturada." }, { status: 409 });

  const updated = await prisma.externalSale.update({
    where: { id },
    data: {
      invoiceUrl: parsed.data.invoiceUrl,
      invoiceName: parsed.data.invoiceName || null,
      invoiceUploadedAt: new Date(),
      invoiceUploadedById: session.user.id,
    },
  });

  if (!sale.isContraEntrega) await notifyInventoryLeadExternalSaleInvoiced(sale.code);
  return NextResponse.json(updated);
}
