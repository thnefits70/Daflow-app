import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminSession } from "@/lib/guards";
import { prisma } from "@/lib/prisma";

const completeSchema = z.object({ period: z.string().min(1) });

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireAdminSession();
  if (!session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { id } = await params;
  const body = await req.json().catch(() => null);
  const parsed = completeSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });

  // Only admin can reach this route (requireAdminSession) — admin isn't a
  // real User row, so completedById always stays null here, same as every
  // other admin-triggered "who completed this" field in this app.
  const record = await prisma.periodicReminderCompletion.upsert({
    where: { reminderId_period: { reminderId: id, period: parsed.data.period } },
    create: { reminderId: id, period: parsed.data.period, completedById: null },
    update: {},
  });

  return NextResponse.json(record);
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireAdminSession();
  if (!session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { id } = await params;
  const period = req.nextUrl.searchParams.get("period");
  if (!period) return NextResponse.json({ error: "Falta el periodo." }, { status: 400 });

  await prisma.periodicReminderCompletion.deleteMany({ where: { reminderId: id, period } });
  return NextResponse.json({ ok: true });
}
