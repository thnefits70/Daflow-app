import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/guards";
import { previewJustCutoverSync, applyJustCutoverSync } from "@/lib/stockKardex";

// Confirmado 2026-09-22, pedido explícito del usuario (admin): corte único
// para dejar de depender de Just — pone el stock y costo promedio del
// último archivo que subió Daniel como el nuevo punto de partida en
// INVESTOCK, para TODOS los productos conectados por código, incluso los
// que ya tenían historial real de compras/salidas (a diferencia del botón
// "Cargar saldo inicial", que solo toca productos sin ningún movimiento).
// Decisión explícita del usuario tras ver los números reales: 230 de 400
// productos con movimiento real no coincidían con Just, algunos con
// diferencias grandes — eligió confiar en Just como base y seguir
// afinando producto por producto desde ahí. Ver findJustCutoverCandidates
// en stockKardex.ts.
export async function GET() {
  if (!(await requireAdminSession())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  const rows = await previewJustCutoverSync();
  return NextResponse.json(rows);
}

export async function POST() {
  if (!(await requireAdminSession())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  const result = await applyJustCutoverSync();
  return NextResponse.json(result);
}
