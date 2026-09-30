import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canViewMarketingArrivals } from "@/lib/guards";
import { getMarketingArrivals, getMarketingArrivalConfirmers } from "@/lib/marketingArrivals";

export async function GET() {
  if (!(await canViewMarketingArrivals())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  const session = await auth();
  const [rows, confirmers] = await Promise.all([getMarketingArrivals(), getMarketingArrivalConfirmers()]);

  // Confirmado 2026-09-26: el equipo de Inventario/Fulfillment (Yair entra acá
  // por despacho) no ve montos. Solo admin y Análisis de Mercado ven el costo
  // de la llegada repetida.
  const isAdmin = session?.user.role === "admin";
  const viewer = !isAdmin && session
    ? await prisma.user.findUnique({ where: { id: session.user.id }, select: { department: { select: { code: true } } } })
    : null;
  const seesMoney = isAdmin || viewer?.department?.code === "MKT";
  const safeRows = seesMoney
    ? rows
    : rows.map((row) => {
        const { unitCost, totalCost, shippingCostTotal, ...r } = row;
        void unitCost; void totalCost; void shippingCostTotal;
        return {
        ...r,
        repeatArrival: r.repeatArrival ? { lastConfirmedAt: r.repeatArrival.lastConfirmedAt, costIncreased: r.repeatArrival.costIncreased, stockInWarehouse: r.repeatArrival.stockInWarehouse } : null,
        };
      });

  return NextResponse.json({ rows: safeRows, confirmers });
}
