import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canActOnImprovementPlan } from "@/lib/guards";
import { requestImprovementPlanClosure } from "@/lib/improvementPlan";

const closureSchema = z.object({
  outcome: z.enum(["CONTINUIDAD", "REUBICACION", "REVISION_CONTINUIDAD"]),
  notes: z.string().trim().min(1, "Falta la nota de cierre."),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "No autorizado." }, { status: 401 });

  const { id } = await params;
  const plan = await prisma.improvementPlan.findUnique({ where: { id }, select: { deptId: true, leaderId: true } });
  if (!plan) return NextResponse.json({ error: "No encontrado." }, { status: 404 });
  if (!(await canActOnImprovementPlan(plan))) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const body = await req.json().catch(() => null);
  const parsed = closureSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });
  }

  try {
    const updated = await requestImprovementPlanClosure({
      planId: id,
      actorId: session.user.id,
      outcome: parsed.data.outcome,
      notes: parsed.data.notes,
    });
    return NextResponse.json(updated);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "No se pudo procesar el cierre." }, { status: 400 });
  }
}
