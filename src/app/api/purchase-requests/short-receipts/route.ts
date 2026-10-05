import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { canSubmitPurchaseRequests, canConfirmPurchaseReceiving, canApprovePurchaseRequests, canManageOutflowPurchaseGestion } from "@/lib/guards";
import { getShortReceiptsUnclaimed } from "@/lib/purchases";

// Pedido del usuario 2026-10-05: compras recibidas con menos de lo pedido
// cuyo faltante nunca se reclamó (ver getShortReceiptsUnclaimed). Mismo
// criterio de visibilidad que la pestaña Reportes urgentes.
export async function GET(_req: NextRequest) {
  const session = await auth();
  const isAdmin = session?.user.role === "admin";
  if (
    !session ||
    (!isAdmin &&
      !(await canSubmitPurchaseRequests()) &&
      !(await canConfirmPurchaseReceiving()) &&
      !(await canApprovePurchaseRequests()) &&
      !(await canManageOutflowPurchaseGestion()))
  ) {
    return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  }
  return NextResponse.json(await getShortReceiptsUnclaimed());
}
