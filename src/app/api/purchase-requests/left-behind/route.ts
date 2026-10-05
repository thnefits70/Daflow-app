import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { canSubmitPurchaseRequests, canConfirmPurchaseReceiving, canApprovePurchaseRequests, canManageOutflowPurchaseGestion } from "@/lib/guards";
import { getPurchaseLinesLeftBehind } from "@/lib/purchases";

// Pedido de Jariel 2026-10-05: lo que no llegó con el resto del pedido (ver
// getPurchaseLinesLeftBehind). Mismo criterio de visibilidad que la pestaña
// Reportes urgentes.
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
  return NextResponse.json(await getPurchaseLinesLeftBehind());
}
