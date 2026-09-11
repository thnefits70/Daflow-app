import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canActOnImprovementPlan } from "@/lib/guards";
import { draftWeeklyReview } from "@/lib/improvementPlanAi";
import { SUGGESTED_INDICATORS } from "@/lib/improvementPlanConstants";

const draftSchema = z.object({ freeText: z.string().trim().min(1, "Escribe cómo fue la semana.") });

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "No autorizado." }, { status: 401 });

  const { id } = await params;
  const plan = await prisma.improvementPlan.findUnique({ where: { id }, select: { deptId: true, leaderId: true } });
  if (!plan) return NextResponse.json({ error: "No encontrado." }, { status: 404 });
  if (!(await canActOnImprovementPlan(plan))) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

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
    const draft = await draftWeeklyReview({ freeText: parsed.data.freeText, actorId: session.user.id, indicators: SUGGESTED_INDICATORS });
    return NextResponse.json(draft);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "No se pudo generar el borrador." }, { status: 502 });
  }
}
