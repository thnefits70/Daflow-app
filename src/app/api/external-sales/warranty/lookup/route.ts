import { NextRequest, NextResponse } from "next/server";
import { canDeclareExternalSales } from "@/lib/guards";
import { lookupWarrantySource } from "@/lib/localWarranty";

// Lee el PDF ya guardado del corte para sacar cliente, dirección y productos
// de la guía — puede tardar en un lote grande.
export const maxDuration = 60;

// Pedido del usuario 2026-10-02: el asesor escribe la guía (o la venta
// VE-000X) y DAFLOW trae solo los datos de lo que de verdad salió.
export async function GET(req: NextRequest) {
  if (!(await canDeclareExternalSales())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  const ref = req.nextUrl.searchParams.get("ref") ?? "";
  const result = await lookupWarrantySource(ref);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 404 });
  return NextResponse.json(result.source);
}
