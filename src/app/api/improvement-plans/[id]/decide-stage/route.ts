import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canManageImprovementPlan } from "@/lib/guards";
import { decideStageOutcome } from "@/lib/improvementPlan";

const decideSchema = z.object({
  decision: z.enum(["SATISFACTORIO", "INSUFICIENTE", "SIN_MEJORA"]),
  newStageDurationDays: z.number().int().positive().max(120).optional(),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "No autorizado." }, { status: 401 });

  const { id } = await params;
  const plan = await prisma.improvementPlan.findUnique({ where: { id }, select: { deptId: true } });
  if (!plan) return NextResponse.json({ error: "No encontrado." }, { status: 404 });
  if (!(await canManageImprovementPlan(plan.deptId))) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const body = await req.json().catch(() => null);
  const parsed = decideSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });
  }

  try {
    const updated = await decideStageOutcome({
      planId: id,
      actorId: session.user.id,
      decision: parsed.data.decision,
      newStageDurationDays: parsed.data.newStageDurationDays,
    });
    return NextResponse.json(updated);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "No se pudo registrar la decisión." }, { status: 400 });
  }
}
