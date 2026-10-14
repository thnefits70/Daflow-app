import { NextRequest, NextResponse } from "next/server";
import { getPublicProduct } from "@/lib/provedixPublic";
import { logProvedixEvent, productViewAllowed, readVisitor, setVisitorCookies } from "@/lib/provedixVisitor";

// Ficha completa de un producto (precio, margen, ciudades, combos…): solo
// para quien se registró con nombre + WhatsApp.
export async function GET(req: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const { visitorId, leadId } = await readVisitor(req);
  if (!leadId) return NextResponse.json({ error: "Regístrate para ver la ficha completa." }, { status: 401 });
  if (!/^[A-Za-z0-9-]{1,40}$/.test(code)) return NextResponse.json({ error: "Producto no encontrado." }, { status: 404 });
  if (!(await productViewAllowed(req, leadId))) return NextResponse.json({ error: "Abriste muchas fichas seguidas. Espera unos minutos e intenta de nuevo." }, { status: 429 });
  const product = await getPublicProduct(code);
  if (!product) return NextResponse.json({ error: "Producto no encontrado." }, { status: 404 });
  await logProvedixEvent({ visitorId, leadId, type: "product", productCode: code });
  const res = NextResponse.json({ product });
  setVisitorCookies(res, visitorId);
  return res;
}
