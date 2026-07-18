import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminSession } from "@/lib/guards";
import { confirmMonthWinner } from "@/lib/recognitionAdmin";

const schema = z.object({ month: z.string().regex(/^\d{4}-\d{2}$/, "Mes inválido.") });

// Admin-only: freezes the top 3 for a month into MonthlyRecognitionResult —
// this is what makes the podium widget and the winner celebration popup
// show up for everyone. Not automatic on purpose: the user wants a
// deliberate one-click confirmation, not the ranking auto-publishing.
export async function POST(req: NextRequest) {
  const session = await requireAdminSession();
  if (!session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });
  }

  const podium = await confirmMonthWinner(parsed.data.month);
  if (!podium) {
    return NextResponse.json({ error: "No hay evaluaciones para ese mes todavía." }, { status: 409 });
  }

  return NextResponse.json({ ok: true, podium });
}
