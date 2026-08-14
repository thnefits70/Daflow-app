import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canApproveCommissionAmounts } from "@/lib/guards";

// Confirmado 2026-08-14: exclusivo del admin, sin excepción — copia
// pendingAmount -> amount y limpia el pendiente.
export async function POST(_req: Request, { params }: { params: Promise<{ tierId: string; userId: string }> }) {
  if (!(await canApproveCommissionAmounts())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { tierId, userId } = await params;
  const row = await prisma.commissionTierAmount.findUnique({ where: { tierId_userId: { tierId, userId } } });
  if (!row || row.pendingAmount === null) return NextResponse.json({ error: "No hay ningún cambio pendiente." }, { status: 400 });

  const updated = await prisma.commissionTierAmount.update({
    where: { tierId_userId: { tierId, userId } },
    data: { amount: row.pendingAmount, pendingAmount: null, approvedAt: new Date() },
  });
  return NextResponse.json(updated);
}
