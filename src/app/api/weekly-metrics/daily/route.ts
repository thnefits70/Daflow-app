import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getDispatchedDailyBreakdown } from "@/lib/dispatchedDaily";

// Desglose por día de "Pedidos despachados" (pedido de Daniel 2026-10-13).
// Mismo público que el gráfico: cualquiera con sesión.
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  const week = req.nextUrl.searchParams.get("week") ?? "";
  if (!/^\d{4}-W\d{2}$/.test(week)) return NextResponse.json({ error: "Semana no válida." }, { status: 400 });
  const data = await getDispatchedDailyBreakdown(week);
  if (!data) return NextResponse.json({ error: "Esa semana no tiene desglose por día (es de antes de los cortes automáticos)." }, { status: 404 });
  return NextResponse.json(data);
}
