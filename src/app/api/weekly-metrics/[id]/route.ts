import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { canEditDeptKpis, canJustifyFillRate } from "@/lib/guards";

const updateSchema = z.object({
  value: z.number().int().min(0),
  prepared: z.number().int().min(0).nullable().optional(),
  generated: z.number().int().min(0).nullable().optional(),
  outOfStock: z.number().int().min(0).nullable().optional(),
  justification: z.string().trim().max(2000).optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const existing = await prisma.weeklyMetricRecord.findUnique({ where: { id }, select: { deptId: true } });
  if (!existing) return NextResponse.json({ error: "No encontrado." }, { status: 404 });
  if (!(await canEditDeptKpis(existing.deptId))) {
    return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });
  }

  const { value, prepared, generated, outOfStock, justification } = parsed.data;
  const hasBreakdown = prepared != null || generated != null || outOfStock != null;
  const notDispatched = hasBreakdown ? (prepared ?? 0) + (generated ?? 0) + (outOfStock ?? 0) : null;

  // Mismo criterio que POST /api/weekly-metrics (confirmado 2026-09-08): si
  // la edición deja esta semana en alerta (<95%) y quien edita es el líder
  // de Fulfillment, no se puede guardar sin la explicación.
  const total = hasBreakdown ? value + notDispatched! : 0;
  const fillRatePct = total > 0 ? Math.round((value / total) * 100) : null;
  const needsJustification = fillRatePct !== null && fillRatePct < 95;
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
