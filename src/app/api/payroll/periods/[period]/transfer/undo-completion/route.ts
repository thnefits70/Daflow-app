import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdminSession } from "@/lib/guards";
import { isValidPeriod } from "@/lib/payroll";

// Confirmado 2026-08-24: caso real — antes de que /transfer/proof bloqueara
// comprobantes que no coinciden, una transferencia de $3035.63 se confirmó
// con un comprobante de $3. Este botón le da al admin una salida
// self-service para deshacer una confirmación así (sin necesitar un script
// de base de datos) y volver a subir el comprobante correcto.
export async function POST(req: NextRequest, { params }: { params: Promise<{ period: string }> }) {
  if (!(await requireAdminSession())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { period } = await params;
  if (!isValidPeriod(period)) return NextResponse.json({ error: "Período inválido." }, { status: 400 });

  const payrollPeriod = await prisma.payrollPeriod.findUnique({ where: { period }, include: { transfer: true } });
  if (!payrollPeriod?.transfer) return NextResponse.json({ error: "Todavía no hay una transferencia propuesta para este período." }, { status: 404 });
  if (payrollPeriod.transfer.status !== "COMPLETED") {
    return NextResponse.json({ error: "Esta transferencia no está marcada como completada." }, { status: 409 });
  }

  const updated = await prisma.payrollTransfer.update({
    where: { id: payrollPeriod.transfer.id },
    data: {
      status: "APPROVED",
      proofUrl: null,
      proofName: null,
      completedAt: null,
      confirmedWithoutProof: false,
      confirmedWithoutProofNote: null,
      confirmedWithoutProofAt: null,
      confirmedWithoutProofById: null,
    },
  });

  return NextResponse.json(updated);
}
