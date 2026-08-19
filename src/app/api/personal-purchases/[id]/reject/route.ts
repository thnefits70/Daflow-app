import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { canConfirmPersonalPurchaseInventory, canConfirmPersonalPurchaseFinance } from "@/lib/guards";
import { sendPushToOwner } from "@/lib/webPush";

const schema = z.object({ reason: z.string().trim().min(1) });

// Confirmado 2026-08-18: puede rechazar quien tenga el paso pendiente en
// ese momento — Daniel si sigue PENDING_INVENTORY, Nairoby/admin si ya
// pasó a PENDING_FINANCE.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const order = await prisma.personalPurchaseOrder.findUnique({ where: { id }, select: { status: true, employeeId: true } });
  if (!order) return NextResponse.json({ error: "No encontrado." }, { status: 404 });

  const guardOk =
    order.status === "PENDING_INVENTORY"
      ? await canConfirmPersonalPurchaseInventory()
      : order.status === "PENDING_FINANCE"
        ? await canConfirmPersonalPurchaseFinance()
        : false;
  if (!guardOk) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });

  const session = await auth();
  const isAdmin = session!.user.role === "admin";
  const updated = await prisma.personalPurchaseOrder.update({
    where: { id },
    data: { status: "REJECTED", rejectedAt: new Date(), rejectedById: isAdmin ? null : session!.user.id, rejectionReason: parsed.data.reason },
  });

  await sendPushToOwner(order.employeeId, {
    title: "❌ Tu compra personal fue rechazada",
    body: parsed.data.reason,
    url: "/area/compras-personales",
  }).catch(() => null);

  return NextResponse.json(updated);
}
