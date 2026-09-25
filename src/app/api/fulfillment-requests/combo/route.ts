import { NextRequest, NextResponse } from "next/server";
import { canSubmitFulfillmentRequest } from "@/lib/guards";
import { findComboByCode } from "@/lib/fulfillmentGuides";

// Yair vincula un ID de Rocket a un combo de Dropi que ya existe: busca el
// combo por su código para ver qué productos trae antes de confirmar.
export async function GET(req: NextRequest) {
  if (!(await canSubmitFulfillmentRequest())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  const code = (req.nextUrl.searchParams.get("code") ?? "").trim();
  if (!code) return NextResponse.json({ error: "Escribe el código del combo." }, { status: 400 });
  const combo = await findComboByCode(code);
  if (!combo) return NextResponse.json({ error: "No existe un combo con ese código." }, { status: 404 });
  return NextResponse.json(combo);
}
