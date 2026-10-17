import { NextRequest, NextResponse } from "next/server";
import { canAccessNick } from "@/lib/guards";
import { runNickSyncTick } from "@/lib/nick/sync";
import { runServientregaTick } from "@/lib/nick/servientrega";

export const maxDuration = 60;

// "Actualizar ahora": corre una parte (~40 s) de la vuelta de las 3 cuentas.
// La pantalla lo vuelve a llamar mientras alguna cuenta siga "en_curso".
// force=true solo en la primera llamada (empieza una vuelta aunque la
// última haya sido hace menos de 2 horas).
export async function POST(req: NextRequest) {
  if (!(await canAccessNick())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  const body = (await req.json().catch(() => ({}))) as { force?: boolean };
  // La primera llamada también lee el rastreo de Servientrega (2026-10-17).
  const servientrega = body.force ? await runServientregaTick({ budgetMs: 15_000 }).catch(() => null) : null;
  const progress = await runNickSyncTick({ force: !!body.force, budgetMs: body.force ? 25_000 : 40_000 });
  return NextResponse.json({ progress, servientrega });
}
