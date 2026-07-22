import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { canEditDeptKpis } from "@/lib/guards";

const createSchema = z.object({
  deptId: z.string().min(1),
  name: z.string().trim().min(1, "El nombre es obligatorio."),
  amount: z.number().positive().optional(),
  paymentMethod: z.string().trim().optional(),
  dueDay: z.number().int().min(1).max(31),
  reminderStartDay: z.number().int().min(1).max(31),
});

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });
  }

  if (!(await canEditDeptKpis(parsed.data.deptId))) {
    return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  }

  const reminder = await prisma.paymentReminder.create({
    data: {
      deptId: parsed.data.deptId,
      name: parsed.data.name,
      amount: parsed.data.amount ?? null,
      paymentMethod: parsed.data.paymentMethod || null,
      dueDay: parsed.data.dueDay,
      reminderStartDay: parsed.data.reminderStartDay,
    },
  });

  return NextResponse.json(reminder, { status: 201 });
}
