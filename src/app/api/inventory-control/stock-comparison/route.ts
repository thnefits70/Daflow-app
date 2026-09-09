import { NextRequest, NextResponse } from "next/server";
import { canManageInventoryControl } from "@/lib/guards";
import { getStockComparisonForPeriod } from "@/lib/stockKardexComparison";

// Confirmado 2026-09-09 (Fase 3, INVESTOCK): consulta la comparación ya
// calculada de una semana (se calcula sola al guardar el export de Just —
// ver stock-snapshot/save/route.ts), para poder verla de nuevo sin tener
// que volver a subir el archivo.
export async function GET(req: NextRequest) {
  if (!(await canManageInventoryControl())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const period = req.nextUrl.searchParams.get("period");
  if (!period) return NextResponse.json({ error: "Falta el período." }, { status: 400 });

  const rows = await getStockComparisonForPeriod(period);
  return NextResponse.json(rows);
}
