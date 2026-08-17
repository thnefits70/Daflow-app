import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canViewPayrollRoles } from "@/lib/guards";

// Historial completo (todas las áreas) de horas extra aprobadas y
// rechazadas — solo lectura, para admin y Nairoby (mismo criterio de
// acceso que el resto de Nómina, ver canViewPayrollRoles).
export async function GET() {
  if (!(await canViewPayrollRoles())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const cutoff = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
  const entries = await prisma.overtimeEntry.findMany({
    where: { date: { gte: cutoff }, OR: [{ approvedAt: { not: null } }, { rejectedAt: { not: null } }] },
    orderBy: { date: "desc" },
    include: {
      employee: { select: { id: true, name: true, department: { select: { name: true } } } },
      enteredBy: { select: { name: true } },
    },
  });

  return NextResponse.json(
    entries.map((e) => ({
      id: e.id,
      employee: e.employee,
      date: e.date.toISOString(),
      minutesExtra: e.minutesExtra,
      enteredByName: e.enteredBy?.name ?? null,
      approvedAt: e.approvedAt?.toISOString() ?? null,
      rejectedAt: e.rejectedAt?.toISOString() ?? null,
    }))
  );
}
