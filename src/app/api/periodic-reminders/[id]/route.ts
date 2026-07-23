import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAdminSession } from "@/lib/guards";

const updateSchema = z.object({
  title: z.string().trim().min(1).optional(),
  detail: z.string().trim().optional(),
  recurrence: z.enum(["DAILY", "WEEKLY", "ONCE"]).optional(),
  weekday: z.number().int().min(1).max(7).nullable().optional(),
  date: z.string().nullable().optional(),
  timeOfDay: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
  isActive: z.boolean().optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireAdminSession();
  if (!session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { id } = await params;
  const body = await req.json().catch(() => null);
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });
  }
  const d = parsed.data;

  const updated = await prisma.periodicReminder.update({
    where: { id },
    data: {
      ...(d.title !== undefined ? { title: d.title } : {}),
      ...(d.detail !== undefined ? { detail: d.detail } : {}),
      ...(d.recurrence !== undefined ? { recurrence: d.recurrence } : {}),
      ...(d.weekday !== undefined ? { weekday: d.weekday } : {}),
      ...(d.date !== undefined ? { date: d.date ? new Date(d.date) : null } : {}),
      ...(d.timeOfDay !== undefined ? { timeOfDay: d.timeOfDay } : {}),
      ...(d.isActive !== undefined ? { isActive: d.isActive } : {}),
    },
  });

  return NextResponse.json(updated);
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireAdminSession();
  if (!session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { id } = await params;
  await prisma.periodicReminder.delete({ where: { id } }).catch(() => null);
  return NextResponse.json({ ok: true });
}
