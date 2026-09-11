import { NextResponse } from "next/server";
import { canApprovePurchaseRequests } from "@/lib/guards";
import { getBuyerDebtConfirmationQueue } from "@/lib/supplierDebt";

// Confirmado 2026-09-11: mismo criterio que la Bandeja de aprobación — quien
// tiene el permiso de aprobar compras (hoy Bryan) ve esto para actuar; admin
// también lo ve, pero de solo lectura (canApprovePurchaseRequests le da
// visibilidad sin darle el botón — eso lo gatea canActOnPurchaseApproval,
// exclusivo de Bryan, en las rutas de confirmar/rechazar).
export async function GET() {
  if (!(await canApprovePurchaseRequests())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  const items = await getBuyerDebtConfirmationQueue();
  return NextResponse.json(items);
}
