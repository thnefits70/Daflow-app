import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canViewPayrollRoles } from "@/lib/guards";

// Roster completo para la pantalla de perfiles de Nómina (sueldo +
// interruptores) — solo Nairoby/admin.
export async function GET() {
  if (!(await canViewPayrollRoles())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const employees = await prisma.user.findMany({
    where: { isActive: true },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      position: true,
      department: { select: { name: true } },
      payrollProfile: true,
    },
  });
  return NextResponse.json(employees);
}
