import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canViewPayrollRoles } from "@/lib/guards";

export async function GET() {
  if (!(await canViewPayrollRoles())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  const periods = await prisma.payrollPeriod.findMany({ orderBy: { period: "desc" } });
  return NextResponse.json(periods);
}
