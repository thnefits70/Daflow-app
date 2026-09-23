import { NextResponse } from "next/server";
import { canViewFulfillmentRequests } from "@/lib/guards";
import { listRecentLots } from "@/lib/fulfillmentGuides";

// Cortes recientes (más nuevo primero) — el historial "por día" se arma en
// el navegador agrupando por `day`.
export async function GET() {
  if (!(await canViewFulfillmentRequests())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  return NextResponse.json(await listRecentLots());
}
