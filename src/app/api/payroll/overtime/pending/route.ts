import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canApproveOvertimeHours } from "@/lib/guards";

export async function GET() {
  if (!(await canApproveOvertimeHours())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const entries = await prisma.overtimeEntry.findMany({
    where: { approvedAt: null, rejectedAt: null },
    orderBy: { date: "asc" },
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
    }))
  );
}
