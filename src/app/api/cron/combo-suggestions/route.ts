import { NextRequest, NextResponse } from "next/server";
import { generateComboSuggestions } from "@/lib/comboSuggestions";

// Varias consultas de IA en paralelo (una por grupo de 20 ganadores).
export const maxDuration = 300;

// Pedido del usuario 2026-10-03: las sugerencias de combos se arman SOLAS
// una vez por semana (lunes a la medianoche de Guayaquil, ver vercel.json)
// — la IA gasta una sola vez y la lista queda fija toda la semana. Nadie
// presiona nada. Mismo CRON_SECRET que los otros crons.
export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }
  const result = await generateComboSuggestions("system");
  return NextResponse.json({ ok: true, ...result });
}
