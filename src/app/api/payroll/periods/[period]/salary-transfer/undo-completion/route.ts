import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdminSession } from "@/lib/guards";
import { isValidPeriod } from "@/lib/payroll";

export async function POST(req: NextRequest, { params }: { params: Promise<{ period: string }> }) {
  if (!(await requireAdminSession())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { period } = await params;
  if (!isValidPeriod(period)) return NextResponse.json({ error: "Período inválido." }, { status: 400 });

  const payrollPeriod = await prisma.payrollPeriod.findUnique({ where: { period }, include: { nairobySalaryTransfer: true } });
  if (!payrollPeriod?.nairobySalaryTransfer) return NextResponse.json({ error: "Todavía no hay un sueldo de Nairoby propuesto para este período." }, { status: 404 });
  if (payrollPeriod.nairobySalaryTransfer.status !== "COMPLETED") {
    return NextResponse.json({ error: "Esta transferencia no está marcada como completada." }, { status: 409 });
  }

  const updated = await prisma.payrollNairobySalaryTransfer.update({
    where: { id: payrollPeriod.nairobySalaryTransfer.id },
    data: {
      status: "APPROVED",
      proofUrl: null,
      proofName: null,
      proofNumber: null,
      completedAt: null,
      confirmedWithoutProof: false,
      confirmedWithoutProofNote: null,
      confirmedWithoutProofAt: null,
      confirmedWithoutProofByName: null,
    },
  });

  return NextResponse.json(updated);
}
