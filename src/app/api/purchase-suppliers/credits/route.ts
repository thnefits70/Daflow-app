import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { canSubmitPurchaseRequests, canRegisterPurchaseInvoices } from "@/lib/guards";
import { getAllPendingCredits } from "@/lib/supplierCredits";

// Confirmado 2026-08-12: pedido explícito del usuario — pestaña nueva
// "Créditos pendientes" con TODO el crédito vivo de la empresa (cualquier
// proveedor), no solo el de uno en particular como ya existía en
// credit-balance. Mismo criterio de acceso que ya usa esa ruta — pero los
// créditos MANUALES (cargados a mano, no de un reporte urgente) solo los ve
// el admin acá: "cuando se ingresa ese crédito manual solo yo pueda ver esa
// operación y valor" — el resto solo ve el crédito automático (de reportes
// urgentes ya resueltos). Esto no le impide a nadie usar un crédito manual
// al solicitar o pagar (credit-balance sigue mostrando todo ahí).
export async function GET(_req: NextRequest) {
  const session = await auth();
  if (!(await canSubmitPurchaseRequests()) && !(await canRegisterPurchaseInvoices())) {
    return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  }
  const isAdmin = session?.user.role === "admin";
  const credits = await getAllPendingCredits();
  return NextResponse.json(isAdmin ? credits : credits.filter((c) => !c.isManual));
}
