import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { canApproveOvertimeHours } from "@/lib/guards";
import { isValidOvertimeDate, nowInEcuador } from "@/lib/payrollCalc";

const schema = z.object({
  employeeId: z.string().min(1),
  date: z.string(), // "YYYY-MM-DD"
  minutesExtra: z.number().int().positive().max(600),
});

// Carga manual del admin — corrige u olvida-el-líder. A diferencia de la
// carga normal del líder, no está limitada a "solo el mismo día" ni a un
// área en particular, y queda aprobada de una vez porque el admin es quien
// la está cargando. enteredById/approvedById quedan null (mismo criterio
// que approve/route.ts: el login de admin no tiene fila propia en User).
export async function POST(req: NextRequest) {
  if (!(await canApproveOvertimeHours())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });

  const employee = await prisma.user.findUnique({ where: { id: parsed.data.employeeId }, select: { id: true, isActive: true } });
  if (!employee?.isActive) return NextResponse.json({ error: "Colaborador no encontrado." }, { status: 404 });

  const date = new Date(`${parsed.data.date}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return NextResponse.json({ error: "Fecha inválida." }, { status: 400 });
  if (!isValidOvertimeDate(date)) return NextResponse.json({ error: "No se trabaja los domingos." }, { status: 400 });
  const today = nowInEcuador(); today.setUTCHours(0, 0, 0, 0);
  if (date > today) return NextResponse.json({ error: "No se puede cargar un día que todavía no pasó." }, { status: 400 });

  const entry = await prisma.overtimeEntry.upsert({
    where: { employeeId_date: { employeeId: employee.id, date } },
    update: { minutesExtra: parsed.data.minutesExtra, enteredById: null, enteredAt: new Date(), approvedAt: new Date(), approvedById: null },
    create: { employeeId: employee.id, date, minutesExtra: parsed.data.minutesExtra, enteredById: null, approvedAt: new Date(), approvedById: null },
  });

  return NextResponse.json(entry, { status: 201 });
}
