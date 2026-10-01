import { NextRequest, NextResponse } from "next/server";
import { generateComboSuggestions } from "@/lib/comboSuggestions";

// Varias consultas de IA en paralelo (una por grupo de 20 ganadores).
export const maxDuration = 300;

// Pedido del usuario 2026-09-30: las sugerencias de combos se arman SOLAS
// una vez al día (medianoche de Guayaquil, ver vercel.json) con lo que ya
// entró al sistema — nadie tiene que presionar "Recalcular". Mismo
// CRON_SECRET que los otros crons.
export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }
  const result = await generateComboSuggestions("system");
  return NextResponse.json({ ok: true, ...result });
}
