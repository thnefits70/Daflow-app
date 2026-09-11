import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canActOnImprovementPlan } from "@/lib/guards";
import { addWeeklyReview } from "@/lib/improvementPlan";

const reviewSchema = z.object({
  weekOf: z.string().min(1, "Falta la semana."),
  scores: z.record(z.string(), z.number().int().min(1).max(5)).refine((s) => Object.keys(s).length > 0, {
    message: "Agrega al menos una calificación.",
  }),
  queMejoro: z.string().trim().min(1, "Falta qué mejoró esta semana."),
  queFalta: z.string().trim().min(1, "Falta qué sigue faltando."),
  accionSiguiente: z.string().trim().min(1, "Falta la acción para la próxima semana."),
  apoyoLider: z.string().trim().min(1, "Falta el apoyo que dará el líder."),
  aiAssisted: z.boolean().default(false),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "No autorizado." }, { status: 401 });

  const { id } = await params;
  const plan = await prisma.improvementPlan.findUnique({ where: { id }, select: { deptId: true, leaderId: true } });
  if (!plan) return NextResponse.json({ error: "No encontrado." }, { status: 404 });
  if (!(await canActOnImprovementPlan(plan))) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const body = await req.json().catch(() => null);
  const parsed = reviewSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });
  }

  try {
    const updated = await addWeeklyReview({
      planId: id,
      actorId: session.user.id,
      weekOf: new Date(parsed.data.weekOf),
      scores: parsed.data.scores,
      queMejoro: parsed.data.queMejoro,
      queFalta: parsed.data.queFalta,
      accionSiguiente: parsed.data.accionSiguiente,
      apoyoLider: parsed.data.apoyoLider,
      aiAssisted: parsed.data.aiAssisted,
    });
    return NextResponse.json(updated, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "No se pudo registrar la evaluación." }, { status: 400 });
  }
}
