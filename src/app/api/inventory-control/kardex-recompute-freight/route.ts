import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/guards";
import { previewKardexFreightRecompute, applyKardexFreightRecompute } from "@/lib/stockKardex";

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
  const result = await applyKardexFreightRecompute();
  return NextResponse.json(result);
}
