import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { canActOnPurchaseReceiving, canReportSupplierStockout, canSubmitPurchaseRequests } from "@/lib/guards";
import { getPurchaseSuggestions, getSuggestionAudiencesForUser } from "@/lib/purchaseSuggestions";

// "Qué comprar" (confirmado 2026-09-29, idea de Daniel) — quien compra
// (Jariel, Nairoby), Daniel (le llegan los urgentes sin atender) y el admin.
export async function GET() {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  const isAdmin = session.user.role === "admin";
  if (!isAdmin && !(await canSubmitPurchaseRequests()) && !(await canActOnPurchaseReceiving())) {
    return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  }
  const [data, audiences, canReportStockout] = await Promise.all([getPurchaseSuggestions(), isAdmin ? Promise.resolve([]) : getSuggestionAudiencesForUser(session.user.id), canReportSupplierStockout()]);
  return NextResponse.json({ ...data, audiences, canReportStockout });
}
