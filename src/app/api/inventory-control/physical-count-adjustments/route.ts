import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/guards";
import { getPendingPhysicalCountAdjustments } from "@/lib/stockKardex";

// Confirmado 2026-09-22, pedido explícito del usuario (admin): bandeja de
// solicitudes de ajuste de stock que Daniel dejó pendientes — exclusiva
// del admin, mismo criterio que PurchaseCatalogItemDeleteRequest.
export async function GET() {
  if (!(await requireAdminSession())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  const rows = await getPendingPhysicalCountAdjustments();
  return NextResponse.json(rows);
}
