import { NextRequest, NextResponse } from "next/server";
import { getRepurchaseAccess } from "@/lib/repurchaseAccess";
import { getRepurchaseAnalysis } from "@/lib/repurchaseReviews";

// Lo que DAFLOW ya sabe del producto para analizar la recompra.
export async function GET(req: NextRequest) {
  const access = await getRepurchaseAccess();
  if (!access?.canView) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  const id = req.nextUrl.searchParams.get("catalogItemId");
  if (!id) return NextResponse.json({ error: "Falta el producto." }, { status: 400 });
  const analysis = await getRepurchaseAnalysis(id, access.userId);
  if (!analysis) return NextResponse.json({ error: "Este producto no es una recompra (nunca estuvo en bodega o es un suministro)." }, { status: 404 });
  return NextResponse.json(analysis);
}
