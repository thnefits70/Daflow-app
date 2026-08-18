import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { computePriceMode, COST_PRICE_RULE_TEXT } from "@/lib/personalPurchases";

// Confirmado 2026-08-18: esto solo declara el MODO de precio (costo o
// Dropi), nunca un monto — Nairoby es quien digita el valor en dólares al
// cerrar la compra. Muestra la regla del precio al costo cuando aplica.
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session || session.user.role === "admin") return NextResponse.json({ error: "No autorizado." }, { status: 401 });

  const productId = req.nextUrl.searchParams.get("productId");
  const buyerRelation = req.nextUrl.searchParams.get("buyerRelation");
  if (!productId || !["SELF", "MINOR_CHILD", "OTHER_FAMILY"].includes(buyerRelation ?? "")) {
    return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });
  }

  try {
    const { priceMode, cooldownNote } = await computePriceMode(session.user.id, productId, buyerRelation as "SELF" | "MINOR_CHILD" | "OTHER_FAMILY");
    return NextResponse.json({ priceMode, cooldownNote, ruleText: priceMode === "COST" ? COST_PRICE_RULE_TEXT : null });
  } catch {
    return NextResponse.json({ error: "Producto no encontrado." }, { status: 404 });
  }
}
