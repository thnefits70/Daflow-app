import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdminSession } from "@/lib/guards";

// Único endpoint que queda del feedback semanal manual: borrar un registro
// roto o duplicado (nunca crearlo ni editar su contenido/estado — eso es
// exclusivo de Mary, ver src/lib/weeklyCheckin.ts). Confirmado 2026-09-02
// tras un bug real: el modelo de Mary volvió a llamar submit_weekly_report
// para la misma semana y dejó dos filas casi idénticas en la bitácora de
// Daniel Morán (INV) — la duplicación en sí se corrigió en
// api/weekly-checkin/route.ts, pero el admin sigue necesitando poder
// limpiar filas ya duplicadas de antes del fix.
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await requireAdminSession())) {
    return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  }
  const { id } = await params;

  await prisma.weeklyReviewRecord.delete({ where: { id } }).catch(() => null);
  return NextResponse.json({ ok: true });
}
