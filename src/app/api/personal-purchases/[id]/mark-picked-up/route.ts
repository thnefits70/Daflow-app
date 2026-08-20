import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canConfirmPersonalPurchaseInventory } from "@/lib/guards";
import { auth } from "@/auth";
import { sendPushToOwner } from "@/lib/webPush";

// Confirmado 2026-08-20: dejó de ser "solo trazabilidad" — ahora es el
// permiso real de retiro. Daniel lo marca cuando observa y aprueba el
// producto que el colaborador se está llevando, y recién acá sale el único
// push real de "ya podés retirarlo" — totalmente independiente del estado
// de pago (se puede aprobar antes, durante o después de que se resuelva el
// pago). Idempotente, mismo espíritu que petty-cash/recharge/[id]/confirm.
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await canConfirmPersonalPurchaseInventory())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { id } = await params;
  const order = await prisma.personalPurchaseOrder.findUnique({ where: { id } });
  if (!order) return NextResponse.json({ error: "No encontrado." }, { status: 404 });
  if (order.pickedUpAt) return NextResponse.json(order);

  const session = await auth();
  const isAdmin = session!.user.role === "admin";
  const updated = await prisma.personalPurchaseOrder.update({
    where: { id },
    data: { pickedUpAt: new Date(), pickedUpApprovedById: isAdmin ? null : session!.user.id },
  });

  await sendPushToOwner(order.employeeId, {
    title: "✅ Ya podés retirarlo",
    body: "Daniel ya lo tiene listo en bodega.",
    url: "/area/compras-personales",
  }).catch(() => null);

  return NextResponse.json(updated);
}
