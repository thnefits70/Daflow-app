import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/guards";
import { previewCutoverDamageCorrection, applyCutoverDamageCorrection } from "@/lib/stockKardex";

// Confirmado 2026-09-22, corrección de un bug real reportado por el
// usuario (caso 172320): el corte único con Just (JUST_CUTOVER_SYNC,
// commit b5588da) pisó 59 productos que ya tenían una compra o salida
// real MÁS NUEVA que el archivo de Just usado — restaura el saldo/costo
// real de esos 59 (ver findCutoverDamageCandidates en stockKardex.ts). El
// bug de origen ya está arreglado (findJustCutoverCandidates ahora se
// salta cualquier producto con movimiento real más nuevo que el archivo),
// esto solo repara el daño que ya se había hecho.
export async function GET() {
  if (!(await requireAdminSession())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  const rows = await previewCutoverDamageCorrection();
  return NextResponse.json(rows);
}

export async function POST() {
  if (!(await requireAdminSession())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  const result = await applyCutoverDamageCorrection();
  return NextResponse.json(result);
}
