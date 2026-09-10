import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { draftImprovementPlan } from "@/lib/improvementPlanAi";

const draftSchema = z.object({ freeText: z.string().trim().min(1, "Escribe una descripción de la situación.") });

// No toca la base de datos — solo devuelve el borrador para que el líder lo
// revise/edite antes de confirmar la creación real del plan (POST /api/improvement-plans).
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "No autorizado." }, { status: 401 });

  if (session.user.role !== "admin") {
    const user = await prisma.user.findUnique({ where: { id: session.user.id }, select: { isLeader: true } });
    if (!user?.isLeader) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      { error: "El asistente de IA todavía no está conectado — falta configurar la clave de Anthropic en el servidor." },
      { status: 503 },
    );
  }

  const body = await req.json().catch(() => null);
  const parsed = draftSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });
  }

  try {
    const draft = await draftImprovementPlan({ freeText: parsed.data.freeText, actorId: session.user.id });
    return NextResponse.json(draft);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "No se pudo generar el borrador." }, { status: 502 });
  }
}
