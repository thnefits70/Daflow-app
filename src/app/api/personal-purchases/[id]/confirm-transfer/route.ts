import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canConfirmPersonalPurchaseTransfer } from "@/lib/guards";
import { notifyOwner } from "@/lib/notifications";

// Confirmado 2026-08-20: el "segundo paso" de la confirmación (revisar tu
// banco real y confirmar dos veces) vive en el cliente como un modal — este
// endpoint es lo que dispara el botón final de ese modal. Exclusivo del
// admin (canConfirmPersonalPurchaseTransfer). Avisa a Nairoby/FIN para que
// cierre — no toca firstPayoutMonth para nada.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await canConfirmPersonalPurchaseTransfer())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { id } = await params;
  const order = await prisma.personalPurchaseOrder.findUnique({ where: { id }, include: { employee: { select: { name: true } } } });
  if (!order) return NextResponse.json({ error: "No encontrado." }, { status: 404 });
  if (order.status !== "PENDING_ADMIN_CONFIRM") return NextResponse.json({ error: "Ya fue procesado." }, { status: 409 });

  const updated = await prisma.personalPurchaseOrder.update({
    where: { id },
    data: { status: "PENDING_NAIROBY_CLOSE", transferAdminConfirmedAt: new Date(), transferAdminConfirmedById: null },
  });

  const finLeader = await prisma.user.findFirst({ where: { isLeader: true, leadsDept: { code: "FIN" } }, select: { id: true } });
  if (finLeader) {
    await notifyOwner(finLeader.id, {
      title: "🏦 Transferencia confirmada — falta cerrar",
      body: `${order.employee.name} — $${order.totalAmount?.toFixed(2)} · ya confirmé que llegó`,
      url: "/area/nomina?tab=pagos&ptab=comprasfinanzas",
    });
  }

  return NextResponse.json(updated);
}
