import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canCreatePersonalReminder } from "@/lib/guards";

const createSchema = z
  .object({
    deptId: z.string().min(1),
    title: z.string().trim().min(1, "El título es obligatorio."),
    detail: z.string().trim().optional(),
    recurrence: z.enum(["DAILY", "WEEKLY", "ONCE"]),
    weekdays: z.array(z.number().int().min(1).max(6)).optional(),
    date: z.string().optional(),
    timeOfDay: z.string().regex(/^\d{2}:\d{2}$/).optional(),
    notifyPush: z.boolean().optional(),
  })
  .refine((v) => v.recurrence !== "WEEKLY" || (v.weekdays && v.weekdays.length > 0), {
    message: "Elige al menos un día de la semana.",
    path: ["weekdays"],
  })
  .refine((v) => v.recurrence !== "ONCE" || !!v.date, {
    message: "Elige la fecha.",
    path: ["date"],
  });

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });
  }
  const d = parsed.data;

  if (!(await canCreatePersonalReminder(d.deptId))) {
    return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  }
  const session = await auth();
  const createdById = session!.user.role === "admin" ? null : session!.user.id;

  const reminder = await prisma.periodicReminder.create({
    data: {
      deptId: d.deptId,
      title: d.title,
      detail: d.detail || "",
      recurrence: d.recurrence,
      weekdays: d.recurrence === "WEEKLY" ? d.weekdays! : [],
      date: d.recurrence === "ONCE" && d.date ? new Date(d.date) : null,
      timeOfDay: d.timeOfDay || null,
      createdById,
      notifyPush: d.notifyPush ?? false,
    },
  });

  return NextResponse.json(reminder, { status: 201 });
}
