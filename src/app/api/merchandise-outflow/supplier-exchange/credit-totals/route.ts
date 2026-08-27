import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getConfirmedSupplierExchangeCreditTotals } from "@/lib/supplierCredits";

// Confirmado 2026-08-27, pedido explícito del usuario: total de crédito ya
// confirmado por proveedor (entre todos sus lotes de "Cambio con
// proveedor"), con el detalle de cuáles solicitudes lo componen — lo
// consumen tanto la vista de quien gestiona (Bryan) como la vista de solo
// lectura de admin/Daniel, por eso no tiene un gate de permiso más
// específico que estar autenticado.
export async function GET() {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  const totals = await getConfirmedSupplierExchangeCreditTotals();
  return NextResponse.json(totals);
}
