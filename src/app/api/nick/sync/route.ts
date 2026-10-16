import { NextRequest, NextResponse } from "next/server";
import { canAccessNick } from "@/lib/guards";
import { runNickSyncTick } from "@/lib/nick/sync";

export const maxDuration = 60;

// "Actualizar ahora": corre una parte (~40 s) de la vuelta de las 3 cuentas.
// La pantalla lo vuelve a llamar mientras alguna cuenta siga "en_curso".
// force=true solo en la primera llamada (empieza una vuelta aunque la
// última haya sido hace menos de 2 horas).
export async function POST(req: NextRequest) {
  if (!(await canAccessNick())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  const body = (await req.json().catch(() => ({}))) as { force?: boolean };
  const progress = await runNickSyncTick({ force: !!body.force, budgetMs: 40_000 });
  return NextResponse.json({ progress });
}
