import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canEditDeptKpis } from "@/lib/guards";

const completeSchema = z.object({
  period: z.string().regex(/^\d{4}-\d{2}$/),
  amountPaid: z.number().positive("Ingresa el monto que se pagó."),
});

// Marks (or corrects) the current period as paid — always a manually
// entered amount, never a pre-filled reference (amounts vary every month).
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "No autorizado." }, { status: 401 });

  const { id } = await params;
  const reminder = await prisma.paymentReminder.findUnique({ where: { id } });
  if (!reminder) return NextResponse.json({ error: "No encontrado." }, { status: 404 });
  if (!(await canEditDeptKpis(reminder.deptId))) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const body = await req.json().catch(() => null);
  const parsed = completeSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });
  }

  const completedById = session.user.role === "admin" ? null : session.user.id;
  const record = await prisma.paymentReminderRecord.upsert({
    where: { reminderId_period: { reminderId: id, period: parsed.data.period } },
    create: { reminderId: id, period: parsed.data.period, amountPaid: parsed.data.amountPaid, completedById },
    update: { amountPaid: parsed.data.amountPaid, completedById, completedAt: new Date() },
  });

  return NextResponse.json(record);
}

// Undo — reverts a period back to pending (e.g. marked by mistake).
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const period = req.nextUrl.searchParams.get("period");
  if (!period || !/^\d{4}-\d{2}$/.test(period)) {
    return NextResponse.json({ error: "Falta el periodo." }, { status: 400 });
  }

  const reminder = await prisma.paymentReminder.findUnique({ where: { id } });
  if (!reminder) return NextResponse.json({ ok: true });
  if (!(await canEditDeptKpis(reminder.deptId))) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  await prisma.paymentReminderRecord.deleteMany({ where: { reminderId: id, period } });
  return NextResponse.json({ ok: true });
}
