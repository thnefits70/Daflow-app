import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canApproveFixedMonthlyBonus } from "@/lib/guards";

// Confirmado 2026-08-17: exclusivo del admin, sin excepción — copia
// pendingAmount -> amount y limpia el pendiente.
export async function POST(_req: Request, { params }: { params: Promise<{ userId: string }> }) {
  if (!(await canApproveFixedMonthlyBonus())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { userId } = await params;
  const row = await prisma.fixedMonthlyBonus.findUnique({ where: { userId } });
  if (!row || row.pendingAmount === null) return NextResponse.json({ error: "No hay ningún cambio pendiente." }, { status: 400 });

  const updated = await prisma.fixedMonthlyBonus.update({
    where: { userId },
    data: { amount: row.pendingAmount, pendingAmount: null, approvedAt: new Date() },
  });
  return NextResponse.json(updated);
}
