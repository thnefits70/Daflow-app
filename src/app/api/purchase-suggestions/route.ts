import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { canActOnPurchaseReceiving, canApprovePurchaseRequests, canReportSupplierStockout, canSubmitPurchaseRequests, dbUserId } from "@/lib/guards";
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
  const [data, audiences, canReportStockout, canDiscard] = await Promise.all([
    getPurchaseSuggestions(),
    isAdmin ? Promise.resolve([]) : getSuggestionAudiencesForUser(session.user.id),
    canReportSupplierStockout(),
    canDiscardSuggestions(dbUserId(session.user.id), isAdmin),
  ]);
  const countPausedUntil = isPhysicalCountPause() ? PHYSICAL_COUNT_UNTIL.toISOString() : null;
  return NextResponse.json({ ...data, audiences, canReportStockout, canDiscard, countPausedUntil });
}
