import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { canEditDeptKpis, canJustifyFillRate } from "@/lib/guards";
import { getOldestUnjustifiedFillRateWeek, fillRateJustificationRuleAppliesTo } from "@/lib/dashboard";
import { computeAutoCounts, fillRateNumbers, isAutoFillRateWeek } from "@/lib/autoFillRate";

const updateSchema = z.object({
  value: z.number().int().min(0),
  prepared: z.number().int().min(0).nullable().optional(),
  generated: z.number().int().min(0).nullable().optional(),
  outOfStock: z.number().int().min(0).nullable().optional(),
  justification: z.string().trim().max(2000).optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const existing = await prisma.weeklyMetricRecord.findUnique({ where: { id }, select: { deptId: true, week: true } });
  if (!existing) return NextResponse.json({ error: "No encontrado." }, { status: 404 });
  if (!(await canEditDeptKpis(existing.deptId))) {
    return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });
  }

  const { justification } = parsed.data;
  let { value, prepared, generated, outOfStock } = parsed.data;
  // Desde la semana 40 (Fulfillment) solo Preparadas/Generadas son de Yair;
  // lo demás se calcula con los cortes — ver autoFillRate.ts.
  if (isAutoFillRateWeek(existing.week)) {
    const dept = await prisma.department.findUnique({ where: { id: existing.deptId }, select: { code: true } });
    if (dept?.code === "FUL") {
      prepared = prepared ?? 0;
      generated = generated ?? 0;
      const nums = fillRateNumbers(await computeAutoCounts(existing.week), prepared, generated);
      value = nums.value;
      outOfStock = nums.outOfStock;
    }
  }
  const hasBreakdown = prepared != null || generated != null || outOfStock != null;
  const notDispatched = hasBreakdown ? (prepared ?? 0) + (generated ?? 0) + (outOfStock ?? 0) : null;

  // Mismo criterio que POST /api/weekly-metrics (confirmado 2026-09-08): si
  // hay OTRA semana anterior en alerta sin explicar, no se puede seguir
  // editando/registrando hasta resolverla — ver
  // getOldestUnjustifiedFillRateWeek.
  if (await canJustifyFillRate()) {
    const backlog = await getOldestUnjustifiedFillRateWeek(existing.deptId, existing.week);
    if (backlog) {
      return NextResponse.json(
        {
          error: `Todavía tienes la semana ${backlog.week} sin explicar (quedó en ${backlog.fillRatePct}%, alerta) — escribe esa explicación antes de guardar otro registro.`,
        },
        { status: 400 }
      );
    }
  }

  // Mismo criterio que POST /api/weekly-metrics (confirmado 2026-09-08): si
  // la edición deja esta semana en alerta (<95%) y quien edita es el líder
  // de Fulfillment, no se puede guardar sin la explicación.
  const total = hasBreakdown ? value + notDispatched! : 0;
  const fillRatePct = total > 0 ? Math.round((value / total) * 100) : null;
  // Confirmado 2026-09-12: semanas de antes de que la regla existiera
  // (2026-09-08) quedan exentas — ver fillRateJustificationRuleAppliesTo.
  const needsJustification = fillRatePct !== null && fillRatePct < 95 && fillRateJustificationRuleAppliesTo(existing.week);
  if (needsJustification && (await canJustifyFillRate())) {
    if (!justification || justification.length < 10) {
      return NextResponse.json(
        { error: `Este Fill Rate quedó en ${fillRatePct}% (alerta) — agrega una explicación para el equipo antes de guardar.` },
        { status: 400 }
      );
    }
  }

  const session = await auth();
  const justificationData =
    needsJustification && justification && justification.length >= 10
      ? { fillRateJustification: justification, fillRateJustificationBy: session?.user.name ?? null, fillRateJustificationAt: new Date() }
      : {};

  const record = await prisma.weeklyMetricRecord.update({
    where: { id },
    data: { value, prepared, generated, outOfStock, notDispatched, ...justificationData },
  });
  return NextResponse.json(record);
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const existing = await prisma.weeklyMetricRecord.findUnique({ where: { id }, select: { deptId: true } });
  if (!existing) return NextResponse.json({ ok: true });
  if (!(await canEditDeptKpis(existing.deptId))) {
    return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  }

  await prisma.weeklyMetricRecord.delete({ where: { id } }).catch(() => null);
  return NextResponse.json({ ok: true });
}
