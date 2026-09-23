import { NextRequest, NextResponse } from "next/server";
import { canViewFulfillmentRequests } from "@/lib/guards";
import { getCompiledDay } from "@/lib/fulfillmentGuides";

// Lote del día (hora de Ecuador): todo lo subido ese día — Dropi y Rocket
// juntos — sumado por producto real, con su desglose de variantes.
export async function GET(req: NextRequest) {
  if (!(await canViewFulfillmentRequests())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  const date = req.nextUrl.searchParams.get("date") ?? "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return NextResponse.json({ error: "Fecha inválida." }, { status: 400 });
  return NextResponse.json(await getCompiledDay(date));
}
