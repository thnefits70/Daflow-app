import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { computePurchasePrice } from "@/lib/personalPurchases";

// Confirmado 2026-08-18: el precio se calcula y muestra en el momento de
// subir la compra — nunca se vuelve a mostrar después en las pantallas de
// aprobación/notificación.
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session || session.user.role === "admin") return NextResponse.json({ error: "No autorizado." }, { status: 401 });

  const productId = req.nextUrl.searchParams.get("productId");
  const buyerRelation = req.nextUrl.searchParams.get("buyerRelation");
  if (!productId || !["SELF", "MINOR_CHILD", "OTHER_FAMILY"].includes(buyerRelation ?? "")) {
    return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });
  }

  try {
    const preview = await computePurchasePrice(session.user.id, productId, buyerRelation as "SELF" | "MINOR_CHILD" | "OTHER_FAMILY");
    return NextResponse.json(preview);
  } catch {
    return NextResponse.json({ error: "Producto no encontrado." }, { status: 404 });
  }
}
