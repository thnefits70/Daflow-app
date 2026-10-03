import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/guards";
import { previewPersonalPurchaseKardexBackfill } from "@/lib/stockKardex";

// Confirmado 2026-09-17, pedido explícito del usuario (admin): botón exclusivo
// suyo, una sola vez, para corregir el stock de las Compras Personales que
// salieron de bodega ANTES de que se arreglara el bug de
// createOutflowForPersonalPurchaseItem (ver merchandiseOutflow.ts) — hasta
// entonces nunca restaban su unidad de INVESTOCK. GET = vista previa, solo
// lectura. Seguro de correr más de una vez: una compra ya corregida no
// vuelve a aparecer como pendiente.
export async function GET() {
  if (!(await requireAdminSession())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  const rows = await previewPersonalPurchaseKardexBackfill();
  return NextResponse.json(rows);
}

export async function POST() {
  if (!(await requireAdminSession())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  // Desactivado 2026-10-03 (pedido del usuario): herramienta de un solo uso
  // que ya se corrió; su recálculo trata las líneas del corte con Just como
  // salidas y dañaría el saldo de los productos que pasaron por el corte.
  return NextResponse.json({ error: "Esta herramienta está desactivada: ya se usó y hoy dañaría el stock." }, { status: 410 });
}
