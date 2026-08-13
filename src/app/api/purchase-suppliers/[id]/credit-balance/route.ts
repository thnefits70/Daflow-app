import { NextRequest, NextResponse } from "next/server";
import { canSubmitPurchaseRequests, canRegisterPurchaseInvoices } from "@/lib/guards";
import { getAvailableCreditsForSupplier, getReservedCreditsForGroup } from "@/lib/supplierCredits";

// Confirmado 2026-08-06: quien solicita ve el crédito disponible al elegir
// proveedor (para saber que hay algo pendiente), y quien paga lo ve otra vez
// al confirmar el pago (para de verdad aplicarlo). Confirmado 2026-08-12: si
// se manda ?groupId=, también se devuelve el crédito YA reservado para esa
// solicitud desde que se pidió — separado del disponible para elegir aparte.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await canSubmitPurchaseRequests()) && !(await canRegisterPurchaseInvoices())) {
    return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  }

  const { id } = await params;
  const groupId = req.nextUrl.searchParams.get("groupId");
  const [credits, reserved] = await Promise.all([
    getAvailableCreditsForSupplier(id),
    groupId ? getReservedCreditsForGroup(groupId) : Promise.resolve([]),
  ]);
  const balance = credits.reduce((s, c) => s + c.amount, 0);
  return NextResponse.json({ balance, credits, reserved });
}
