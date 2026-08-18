import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canManageSalaryAdvances } from "@/lib/guards";

export async function GET() {
  if (!(await canManageSalaryAdvances())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const advances = await prisma.salaryAdvance.findMany({
    where: { status: "PENDING" },
    include: { employee: { select: { name: true } } },
    orderBy: { createdAt: "asc" },
  });
  const accounts = await prisma.employeeBankAccount.findMany({
    where: { employeeId: { in: advances.map((a) => a.employeeId) } },
  });
  const byEmployee = Object.fromEntries(accounts.map((a) => [a.employeeId, a]));
  return NextResponse.json(advances.map((a) => ({ ...a, bankAccount: byEmployee[a.employeeId] ?? null })));
}
