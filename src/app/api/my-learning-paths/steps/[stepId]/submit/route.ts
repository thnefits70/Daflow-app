import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { submitStepAnswers } from "@/lib/learningPaths";

const schema = z.object({
  answers: z.array(
    z.object({
      questionId: z.string().min(1),
      selectedIndex: z.number().int().optional(),
      matchOrder: z.array(z.number().int()).optional(),
      textAnswer: z.string().optional(),
    })
  ),
});

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
    const result = await submitStepAnswers(session.user.id, stepId, parsed.data.answers);
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "No se pudo guardar tus respuestas.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
