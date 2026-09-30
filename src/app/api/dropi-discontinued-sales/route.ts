import { NextResponse } from "next/server";
import { canConfirmDropiOrderCancelled, canProposeMarketProduct, canResolveSupplierStockout } from "@/lib/guards";
import { listDiscontinuedSales } from "@/lib/dropiDiscontinued";

// Pedido del usuario 2026-09-30: productos dados de baja que igual se
// vendieron en Dropi — lo ve el equipo de Análisis de Mercado (mismo criterio
// que la pestaña "Sin stock de proveedor"). Ver lib/dropiDiscontinued.ts.
export async function GET() {
  if (!(await canProposeMarketProduct()) && !(await canResolveSupplierStockout())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  const [rows, canCancelOrder] = await Promise.all([listDiscontinuedSales(), canConfirmDropiOrderCancelled()]);
  return NextResponse.json({ rows, canCancelOrder });
}
