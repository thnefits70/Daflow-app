import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canRegisterPurchaseInvoices } from "@/lib/guards";

// Resumen del mes en curso — solo lo pagado en efectivo con caja chica (no
// transferencias) — para que Finanzas lo cuadre contra el cierre de caja.
export async function GET() {
  if (!(await canRegisterPurchaseInvoices())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

  const rows = await prisma.purchaseRequest.findMany({
    where: { shippingPaymentMethod: "PETTY_CASH", paidAt: { gte: monthStart } },
    select: { shippingCostTotal: true },
  });

  const total = rows.reduce((sum, r) => sum + (r.shippingCostTotal ?? 0), 0);
  return NextResponse.json({ count: rows.length, total });
}
