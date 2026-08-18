import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canApproveCommissionAmounts } from "@/lib/guards";
import { sendPushToOwner } from "@/lib/webPush";

// Confirmado 2026-08-18: mismo aviso que approve/route.ts pero para
// rechazo — necesita leer la fila ANTES de limpiar pendingAmount, porque el
// monto y quién propuso solo existen ahí.
export async function POST(_req: Request, { params }: { params: Promise<{ tierId: string; userId: string }> }) {
  if (!(await canApproveCommissionAmounts())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { tierId, userId } = await params;
  const before = await prisma.commissionTierAmount.findUnique({
    where: { tierId_userId: { tierId, userId } },
    include: { tier: { select: { name: true } }, user: { select: { name: true } } },
  });

  const updated = await prisma.commissionTierAmount.update({
    where: { tierId_userId: { tierId, userId } },
    data: { pendingAmount: null },
  });

  if (before?.proposedById && before.pendingAmount !== null) {
    await sendPushToOwner(before.proposedById, {
      title: "❌ Comisión rechazada",
      body: `${before.user.name} · ${before.tier.name} · $${before.pendingAmount.toFixed(2)}`,
      url: "/area/nomina?tab=pagos&ptab=comisiones",
    }).catch(() => null);
  }

  return NextResponse.json(updated);
}
