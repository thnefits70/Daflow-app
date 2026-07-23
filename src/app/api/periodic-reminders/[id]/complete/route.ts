import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { canEditDeptKpis } from "@/lib/guards";
import { prisma } from "@/lib/prisma";

const completeSchema = z.object({ period: z.string().min(1) });

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "No autorizado." }, { status: 401 });

  const { id } = await params;
  const reminder = await prisma.periodicReminder.findUnique({ where: { id } });
  if (!reminder) return NextResponse.json({ error: "No encontrado." }, { status: 404 });
  if (!(await canEditDeptKpis(reminder.deptId))) {
    return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const parsed = completeSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });

  const completedById = session.user.role === "admin" ? null : session.user.id;
  const record = await prisma.periodicReminderCompletion.upsert({
    where: { reminderId_period: { reminderId: id, period: parsed.data.period } },
    create: { reminderId: id, period: parsed.data.period, completedById },
    update: {},
  });

  return NextResponse.json(record);
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const reminder = await prisma.periodicReminder.findUnique({ where: { id } });
  if (!reminder) return NextResponse.json({ ok: true });
  if (!(await canEditDeptKpis(reminder.deptId))) {
    return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  }

  const period = req.nextUrl.searchParams.get("period");
  if (!period) return NextResponse.json({ error: "Falta el periodo." }, { status: 400 });

  await prisma.periodicReminderCompletion.deleteMany({ where: { reminderId: id, period } });
  return NextResponse.json({ ok: true });
}
