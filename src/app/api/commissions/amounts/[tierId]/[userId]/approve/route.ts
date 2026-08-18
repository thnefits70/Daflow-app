import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canApproveCommissionAmounts } from "@/lib/guards";
import { sendPushToOwner } from "@/lib/webPush";

// Confirmado 2026-08-14: exclusivo del admin, sin excepción — copia
// pendingAmount -> amount y limpia el pendiente. Confirmado 2026-08-18:
// avisa a quien propuso el monto (si fue Nairoby y no el propio admin) que
// ya se aprobó — mismo patrón que la notificación de solicitud de compra
// aprobada/rechazada (review/route.ts).
export async function POST(_req: Request, { params }: { params: Promise<{ tierId: string; userId: string }> }) {
  if (!(await canApproveCommissionAmounts())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { tierId, userId } = await params;
  const row = await prisma.commissionTierAmount.findUnique({
    where: { tierId_userId: { tierId, userId } },
    include: { tier: { select: { name: true } }, user: { select: { name: true } } },
  });
  if (!row || row.pendingAmount === null) return NextResponse.json({ error: "No hay ningún cambio pendiente." }, { status: 400 });

  const updated = await prisma.commissionTierAmount.update({
    where: { tierId_userId: { tierId, userId } },
    data: { amount: row.pendingAmount, pendingAmount: null, approvedAt: new Date() },
  });

  if (row.proposedById) {
    await sendPushToOwner(row.proposedById, {
      title: "✅ Comisión aprobada",
      body: `${row.user.name} · ${row.tier.name} · $${row.pendingAmount.toFixed(2)}`,
      url: "/area/nomina?tab=pagos&ptab=comisiones",
    }).catch(() => null);
  }

  return NextResponse.json(updated);
}
