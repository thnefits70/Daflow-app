import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdminSession } from "@/lib/guards";
import { isValidPeriod } from "@/lib/payroll";

export async function POST(req: NextRequest, { params }: { params: Promise<{ period: string }> }) {
  if (!(await requireAdminSession())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { period } = await params;
  if (!isValidPeriod(period)) return NextResponse.json({ error: "Período inválido." }, { status: 400 });

  const payrollPeriod = await prisma.payrollPeriod.findUnique({ where: { period }, include: { iessTransfer: true } });
  if (!payrollPeriod?.iessTransfer) return NextResponse.json({ error: "Todavía no hay una transferencia de IESS propuesta para este período." }, { status: 404 });
  if (payrollPeriod.iessTransfer.status !== "COMPLETED") {
    return NextResponse.json({ error: "Esta transferencia no está marcada como completada." }, { status: 409 });
  }

  const updated = await prisma.payrollIessTransfer.update({
    where: { id: payrollPeriod.iessTransfer.id },
    data: { status: "APPROVED", proofUrl: null, proofName: null, completedAt: null },
  });

  return NextResponse.json(updated);
}
