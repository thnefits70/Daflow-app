import { NextRequest, NextResponse } from "next/server";
import { canSeeCase, getCasesRole } from "@/lib/provedixCases";
import { stockCheckForCase } from "@/lib/provedixStockCheck";

// Stock real vs publicado en Dropi para un caso de stock (2026-10-17).
// Lee Dropi por la conexión de NICK: puede tardar unos segundos.
export const maxDuration = 60;

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const role = await getCasesRole();
  const { id } = await params;
  if (!role || !(await canSeeCase(id, role.platforms))) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  const r = await stockCheckForCase(id);
  return "error" in r ? NextResponse.json(r, { status: 404 }) : NextResponse.json(r);
}
