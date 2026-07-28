import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { canEditDeptKpis } from "@/lib/guards";

const updateSchema = z.object({
  value: z.number().int().min(0),
  prepared: z.number().int().min(0).nullable().optional(),
  generated: z.number().int().min(0).nullable().optional(),
  outOfStock: z.number().int().min(0).nullable().optional(),
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

  const { prepared, generated, outOfStock } = parsed.data;
  const hasBreakdown = prepared != null || generated != null || outOfStock != null;
  const notDispatched = hasBreakdown ? (prepared ?? 0) + (generated ?? 0) + (outOfStock ?? 0) : null;

  const record = await prisma.weeklyMetricRecord.update({
    where: { id },
    data: { ...parsed.data, notDispatched },
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
