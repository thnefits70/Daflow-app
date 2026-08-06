import { NextRequest, NextResponse } from "next/server";
import { canSubmitPurchaseRequests, canRegisterPurchaseInvoices } from "@/lib/guards";
import { getAvailableCreditsForSupplier } from "@/lib/supplierCredits";

// Confirmado 2026-08-06: quien solicita ve el crédito disponible al elegir
// proveedor (para saber que hay algo pendiente), y quien paga lo ve otra vez
// al confirmar el pago (para de verdad aplicarlo).
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await canSubmitPurchaseRequests()) && !(await canRegisterPurchaseInvoices())) {
    return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  }

  const { id } = await params;
  const credits = await getAvailableCreditsForSupplier(id);
  const balance = credits.reduce((s, c) => s + c.amount, 0);
  return NextResponse.json({ balance, credits });
}
