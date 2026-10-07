import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { canActOnPurchaseReceiving, canApprovePurchaseRequests, canReportSupplierStockout, canSubmitPurchaseRequests, canCreateNewPurchaseRequests, dbUserId } from "@/lib/guards";
import { getOpenRepurchaseByItem } from "@/lib/repurchaseReviews";
import { canDiscardSuggestions, getPurchaseSuggestions, getSuggestionAudiencesForUser, isPhysicalCountPause, PHYSICAL_COUNT_UNTIL } from "@/lib/purchaseSuggestions";

// "Qué comprar" (confirmado 2026-09-29, idea de Daniel) — quien compra
// (Jariel, Nairoby), Daniel (le llegan los urgentes sin atender), quien
// aprueba compras (le llegan los descartes, 2026-10-02) y el admin.
export async function GET() {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  const isAdmin = session.user.role === "admin";
  if (!isAdmin && !(await canSubmitPurchaseRequests()) && !(await canActOnPurchaseReceiving()) && !(await canApprovePurchaseRequests())) {
    return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  }
  const [data, audiences, canReportStockout, canDiscard, canCreateNew, repurchases] = await Promise.all([
    getPurchaseSuggestions(),
    isAdmin ? Promise.resolve([]) : getSuggestionAudiencesForUser(session.user.id),
    canReportSupplierStockout(),
    canDiscardSuggestions(dbUserId(session.user.id), isAdmin),
    canCreateNewPurchaseRequests(),
    getOpenRepurchaseByItem(),
  ]);
  const countPausedUntil = isPhysicalCountPause() ? PHYSICAL_COUNT_UNTIL.toISOString() : null;
  // Calculadora de precio (2026-10-05): quien hace las compras frías (Nairoby) y el admin.
  const canUseCalculator = isAdmin || audiences.includes("cold");
  // Recompras (2026-10-06): quien compra analiza desde cada fila; en la fila
  // se ve si ya hay una RC abierta del producto.
  const canRepurchase = !isAdmin && canCreateNew;
  return NextResponse.json({ ...data, audiences, canReportStockout, canDiscard, countPausedUntil, canUseCalculator, canRepurchase, repurchases });
}
