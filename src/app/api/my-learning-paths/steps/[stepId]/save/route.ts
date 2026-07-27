import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { saveStepAnswer } from "@/lib/learningPaths";

const schema = z.object({
  questionId: z.string().min(1),
  selectedIndex: z.number().int().optional(),
  matchOrder: z.array(z.number().int()).optional(),
  textAnswer: z.string().optional(),
});

// Guarda una sola respuesta a medida que el colaborador avanza (sin marcar el
// paso como terminado) — así si tiene que salir a atender algo urgente, no
// pierde lo que ya contestó.
export async function POST(req: NextRequest, { params }: { params: Promise<{ stepId: string }> }) {
  const session = await auth();
  if (!session || session.user.role !== "employee") {
    return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  }

  const { stepId } = await params;
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });
  }

  try {
    const result = await saveStepAnswer(session.user.id, stepId, parsed.data);
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "No se pudo guardar tu respuesta.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
