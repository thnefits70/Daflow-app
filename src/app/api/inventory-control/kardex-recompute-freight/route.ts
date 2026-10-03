import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/guards";
import { previewKardexFreightRecompute } from "@/lib/stockKardex";

// Confirmado 2026-09-16, pedido explícito del usuario (admin): corrección
// única del historial de Kardex de antes de que approve-receipt/route.ts
// empezara a sumar el flete real a cada compra — exclusiva del admin, botón
// de un solo uso pero seguro de correr más de una vez (ver
// applyKardexFreightRecompute en stockKardex.ts). GET = vista previa, solo
// lectura, para ver qué productos cambiarían antes de tocar la base real.
export async function GET() {
  if (!(await requireAdminSession())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  const rows = await previewKardexFreightRecompute();
  return NextResponse.json(rows);
}

export async function POST() {
  if (!(await requireAdminSession())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  // Desactivado 2026-10-03 (pedido del usuario): herramienta de un solo uso
  // que ya se corrió; su recálculo trata las líneas del corte con Just como
  // salidas y dañaría el saldo de los productos que pasaron por el corte.
  return NextResponse.json({ error: "Esta herramienta está desactivada: ya se usó y hoy dañaría el stock." }, { status: 410 });
}
