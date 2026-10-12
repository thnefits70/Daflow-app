import { NextRequest, NextResponse } from "next/server";
import { getPublicProduct } from "@/lib/provedixPublic";
import { logProvedixEvent, readVisitor, setVisitorCookies } from "@/lib/provedixVisitor";

// Ficha completa de un producto (precio, margen, ciudades, combos…): solo
// para quien se registró con nombre + WhatsApp.
export async function GET(req: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const { visitorId, leadId } = await readVisitor(req);
  if (!leadId) return NextResponse.json({ error: "Regístrate para ver la ficha completa." }, { status: 401 });
  const product = await getPublicProduct(code);
  if (!product) return NextResponse.json({ error: "Producto no encontrado." }, { status: 404 });
  await logProvedixEvent({ visitorId, leadId, type: "product", productCode: code });
  const res = NextResponse.json({ product });
  setVisitorCookies(res, visitorId);
  return res;
}
