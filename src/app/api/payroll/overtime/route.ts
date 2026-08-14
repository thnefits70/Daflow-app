import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canLogOvertimeHours } from "@/lib/guards";
import { isValidOvertimeDate, isOvertimeEntryEditable, nowInEcuador } from "@/lib/payrollCalc";
import { sendPushToOwner } from "@/lib/webPush";
import { actorName } from "@/lib/actorName";

// Confirmado 2026-08-13: el líder solo ve/carga horas de su propia área —
// las últimas ~5 semanas, para ver también lo que ya quedó bloqueado por
// las 24h.
export async function GET() {
  if (!(await canLogOvertimeHours())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const session = await auth();
  const leader = await prisma.user.findUnique({ where: { id: session!.user.id }, select: { deptId: true } });
  if (!leader?.deptId) return NextResponse.json({ error: "No se pudo determinar tu área." }, { status: 400 });

  const cutoff = new Date(Date.now() - 35 * 24 * 60 * 60 * 1000);
  const entries = await prisma.overtimeEntry.findMany({
    where: { date: { gte: cutoff }, employee: { deptId: leader.deptId } },
    orderBy: { date: "desc" },
    include: { employee: { select: { id: true, name: true } }, enteredBy: { select: { name: true } } },
  });

  const now = nowInEcuador();
  return NextResponse.json(
    entries.map((e) => ({
      id: e.id,
      employee: e.employee,
      date: e.date.toISOString(),
      minutesExtra: e.minutesExtra,
      enteredByName: e.enteredBy?.name ?? null,
      approvedAt: e.approvedAt?.toISOString() ?? null,
      editable: !e.approvedAt && isOvertimeEntryEditable(e.date, now),
    }))
  );
}

const schema = z.object({
  employeeId: z.string().min(1),
  date: z.string(), // "YYYY-MM-DD"
  minutesExtra: z.number().int().positive().max(600),
});

export async function POST(req: NextRequest) {
  if (!(await canLogOvertimeHours())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const session = await auth();
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });

  const [leader, employee] = await Promise.all([
    prisma.user.findUnique({ where: { id: session!.user.id }, select: { deptId: true } }),
    prisma.user.findUnique({ where: { id: parsed.data.employeeId }, select: { id: true, deptId: true } }),
  ]);
  if (!employee || !leader?.deptId || employee.deptId !== leader.deptId) {
    return NextResponse.json({ error: "Ese colaborador no es de tu área." }, { status: 403 });
  }

  const date = new Date(`${parsed.data.date}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return NextResponse.json({ error: "Fecha inválida." }, { status: 400 });
  if (!isValidOvertimeDate(date)) return NextResponse.json({ error: "No se trabaja los domingos." }, { status: 400 });
  const today = nowInEcuador(); today.setUTCHours(0, 0, 0, 0);
  if (date > today) return NextResponse.json({ error: "No se puede cargar un día que todavía no pasó." }, { status: 400 });
  if (!isOvertimeEntryEditable(date)) {
    return NextResponse.json({ error: "Ya pasó ese día — las horas extra se cargan siempre el mismo día que se trabajaron." }, { status: 409 });
  }

  const existing = await prisma.overtimeEntry.findUnique({ where: { employeeId_date: { employeeId: employee.id, date } } });
  if (existing?.approvedAt) {
    return NextResponse.json({ error: "Ese día ya fue aprobado — no se puede volver a editar." }, { status: 409 });
  }

  const entry = await prisma.overtimeEntry.upsert({
    where: { employeeId_date: { employeeId: employee.id, date } },
    update: { minutesExtra: parsed.data.minutesExtra, enteredById: session!.user.id, enteredAt: new Date() },
    create: { employeeId: employee.id, date, minutesExtra: parsed.data.minutesExtra, enteredById: session!.user.id },
  });

  const employeeName = await prisma.user.findUnique({ where: { id: employee.id }, select: { name: true } });
  const hours = (parsed.data.minutesExtra / 60).toFixed(2).replace(/\.?0+$/, "");
  await sendPushToOwner("admin", {
    title: "⏱️ Horas extra por aprobar",
    body: `${employeeName?.name ?? "Colaborador"} — ${date.toLocaleDateString("es-EC")} · ${hours}h · cargado por ${actorName(session!.user.name)}`,
    url: "/admin",
  }).catch(() => null);

  return NextResponse.json(entry, { status: 201 });
}
