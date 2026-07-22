import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { canEditDeptKpis } from "@/lib/guards";

const updateSchema = z.object({
  name: z.string().trim().min(1).optional(),
  paymentMethod: z.string().trim().optional().nullable(),
  dueDay: z.number().int().min(1).max(31).optional(),
  reminderStartDay: z.number().int().min(1).max(31).optional(),
  isActive: z.boolean().optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const reminder = await prisma.paymentReminder.findUnique({ where: { id } });
  if (!reminder) return NextResponse.json({ error: "No encontrado." }, { status: 404 });
  if (!(await canEditDeptKpis(reminder.deptId))) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const body = await req.json().catch(() => null);
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });
  }
  const data = parsed.data;

  const updated = await prisma.paymentReminder.update({
    where: { id },
    data: {
      ...(data.name !== undefined ? { name: data.name } : {}),
      ...(data.paymentMethod !== undefined ? { paymentMethod: data.paymentMethod || null } : {}),
      ...(data.dueDay !== undefined ? { dueDay: data.dueDay } : {}),
      ...(data.reminderStartDay !== undefined ? { reminderStartDay: data.reminderStartDay } : {}),
      ...(data.isActive !== undefined ? { isActive: data.isActive } : {}),
    },
  });

  return NextResponse.json(updated);
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const reminder = await prisma.paymentReminder.findUnique({ where: { id } });
  if (!reminder) return NextResponse.json({ ok: true });
  if (!(await canEditDeptKpis(reminder.deptId))) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  await prisma.paymentReminder.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
