import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { canEditDeptKpis } from "@/lib/guards";

const updateSchema = z.object({
  roi: z.number().nullable().optional(),
  monthlySales: z.number().nullable().optional(),
  monthlyProfit: z.number().nullable().optional(),
  notes: z.string().optional(),
  fileUrl: z.string().nullable().optional(),
  fileName: z.string().nullable().optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const existing = await prisma.financeKpiRecord.findUnique({ where: { id }, select: { deptId: true } });
  if (!existing) return NextResponse.json({ error: "No encontrado." }, { status: 404 });
  if (!(await canEditDeptKpis(existing.deptId))) {
    return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });
  }

  const record = await prisma.financeKpiRecord.update({ where: { id }, data: parsed.data });
  return NextResponse.json(record);
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const existing = await prisma.financeKpiRecord.findUnique({ where: { id }, select: { deptId: true } });
  if (!existing) return NextResponse.json({ ok: true });
  if (!(await canEditDeptKpis(existing.deptId))) {
    return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  }

  await prisma.financeKpiRecord.delete({ where: { id } }).catch(() => null);
  return NextResponse.json({ ok: true });
}
