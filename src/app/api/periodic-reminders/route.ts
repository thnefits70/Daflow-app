import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAdminSession } from "@/lib/guards";

const createSchema = z
  .object({
    deptId: z.string().min(1),
    title: z.string().trim().min(1, "El título es obligatorio."),
    detail: z.string().trim().optional(),
    recurrence: z.enum(["DAILY", "WEEKLY", "ONCE"]),
    weekday: z.number().int().min(1).max(7).optional(),
    date: z.string().optional(),
    timeOfDay: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  })
  .refine((v) => v.recurrence !== "WEEKLY" || v.weekday !== undefined, {
    message: "Elige el día de la semana.",
    path: ["weekday"],
  })
  .refine((v) => v.recurrence !== "ONCE" || !!v.date, {
    message: "Elige la fecha.",
    path: ["date"],
  });

export async function POST(req: NextRequest) {
  const session = await requireAdminSession();
  if (!session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });
  }
  const d = parsed.data;

  const reminder = await prisma.periodicReminder.create({
    data: {
      deptId: d.deptId,
      title: d.title,
      detail: d.detail || "",
      recurrence: d.recurrence,
      weekday: d.recurrence === "WEEKLY" ? d.weekday : null,
      date: d.recurrence === "ONCE" && d.date ? new Date(d.date) : null,
      timeOfDay: d.timeOfDay || null,
    },
  });

  return NextResponse.json(reminder, { status: 201 });
}
