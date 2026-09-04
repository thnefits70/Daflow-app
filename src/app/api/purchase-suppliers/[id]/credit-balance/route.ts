import { NextRequest, NextResponse } from "next/server";
import { canSubmitPurchaseRequests, canRegisterPurchaseInvoices, canApprovePurchaseRequests } from "@/lib/guards";
import { getAvailableCreditsForSupplier, getReservedCreditsForGroup } from "@/lib/supplierCredits";

// Confirmado 2026-08-06: quien solicita ve el crédito disponible al elegir
// proveedor (para saber que hay algo pendiente), y quien paga lo ve otra vez
// al confirmar el pago (para de verdad aplicarlo). Confirmado 2026-08-12: si
// se manda ?groupId=, también se devuelve el crédito YA reservado para esa
// solicitud desde que se pidió — separado del disponible para elegir aparte.
// Confirmado 2026-09-04: quien aprueba (Bandeja de aprobación) también debe
// poder consultar el crédito reservado — si no, ve el total sin el crédito
// que el solicitante ya aplicó, y el monto no cuadra con lo que se pidió.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (
    !(await canSubmitPurchaseRequests()) &&
    !(await canRegisterPurchaseInvoices()) &&
    !(await canApprovePurchaseRequests())
  ) {
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
