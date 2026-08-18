import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canApproveFixedMonthlyBonus } from "@/lib/guards";
import { sendPushToOwner } from "@/lib/webPush";

// Confirmado 2026-08-17: exclusivo del admin, sin excepción — copia
// pendingAmount -> amount y limpia el pendiente. Confirmado 2026-08-18:
// avisa a quien propuso el monto (si fue Nairoby y no el propio admin) que
// ya se aprobó — mismo patrón que el aviso de comisiones aprobadas.
export async function POST(_req: Request, { params }: { params: Promise<{ userId: string }> }) {
  if (!(await canApproveFixedMonthlyBonus())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { userId } = await params;
  const row = await prisma.fixedMonthlyBonus.findUnique({ where: { userId }, include: { user: { select: { name: true } } } });
  if (!row || row.pendingAmount === null) return NextResponse.json({ error: "No hay ningún cambio pendiente." }, { status: 400 });

  const updated = await prisma.fixedMonthlyBonus.update({
    where: { userId },
    data: { amount: row.pendingAmount, pendingAmount: null, approvedAt: new Date() },
  });

  if (row.proposedById) {
    await sendPushToOwner(row.proposedById, {
      title: "✅ Bono fijo mensual aprobado",
      body: `${row.user.name} · $${row.pendingAmount.toFixed(2)}/mes`,
      url: "/area/nomina?tab=pagos&ptab=roles",
    }).catch(() => null);
  }

  return NextResponse.json(updated);
}
