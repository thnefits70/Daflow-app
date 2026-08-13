import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canLogOvertimeHours } from "@/lib/guards";
import { overtimeScheduleLabel } from "@/lib/payrollCalc";

// Roster del líder — para el selector de "Colaborador" en la pantalla de
// registrar horas extra. Incluye al propio líder (se registra sus propias
// horas también).
export async function GET() {
  if (!(await canLogOvertimeHours())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const session = await auth();
  const leader = await prisma.user.findUnique({ where: { id: session!.user.id }, select: { deptId: true } });
  if (!leader?.deptId) return NextResponse.json({ error: "No se pudo determinar tu área." }, { status: 400 });

  const team = await prisma.user.findMany({
    where: { isActive: true, deptId: leader.deptId },
    orderBy: { name: "asc" },
    select: { id: true, name: true, payrollProfile: { select: { usesFullLegalOvertimeSchedule: true } } },
  });

  return NextResponse.json(
    team.map((u) => ({
      id: u.id,
      name: u.id === session!.user.id ? `${u.name} (yo)` : u.name,
      scheduleLabel: overtimeScheduleLabel(!!u.payrollProfile?.usesFullLegalOvertimeSchedule),
    }))
  );
}
