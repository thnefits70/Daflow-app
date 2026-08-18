import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canApproveFixedMonthlyBonus } from "@/lib/guards";
import { sendPushToOwner } from "@/lib/webPush";

// Confirmado 2026-08-18: mismo aviso que approve/route.ts pero para
// rechazo — necesita leer la fila ANTES de limpiar pendingAmount, porque el
// monto y quién propuso solo existen ahí.
export async function POST(_req: Request, { params }: { params: Promise<{ userId: string }> }) {
  if (!(await canApproveFixedMonthlyBonus())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { userId } = await params;
  const before = await prisma.fixedMonthlyBonus.findUnique({ where: { userId }, include: { user: { select: { name: true } } } });

  const updated = await prisma.fixedMonthlyBonus.update({
    where: { userId },
    data: { pendingAmount: null },
  });

  if (before?.proposedById && before.pendingAmount !== null) {
    await sendPushToOwner(before.proposedById, {
      title: "❌ Bono fijo mensual rechazado",
      body: `${before.user.name} · $${before.pendingAmount.toFixed(2)}/mes`,
      url: "/area/nomina?tab=pagos&ptab=roles",
    }).catch(() => null);
  }

  return NextResponse.json(updated);
}
