import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { canConfirmPersonalPurchaseInventory, canConfirmPersonalPurchaseFinance } from "@/lib/guards";
import { sendPushToOwner } from "@/lib/webPush";

const schema = z.object({ reason: z.string().trim().min(1, "Contá el motivo del rechazo.") });

// Puede rechazar quien esté a cargo del paso en el que está la compra —
// Daniel si sigue PENDING_INVENTORY, Nairoby/admin si ya está PENDING_FINANCE.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });

  const purchase = await prisma.personalPurchase.findUnique({ where: { id }, include: { employee: { select: { id: true } } } });
  if (!purchase) return NextResponse.json({ error: "No encontrada." }, { status: 404 });

  if (purchase.status === "PENDING_INVENTORY") {
    if (!(await canConfirmPersonalPurchaseInventory())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  } else if (purchase.status === "PENDING_FINANCE") {
    if (!(await canConfirmPersonalPurchaseFinance())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  } else {
    return NextResponse.json({ error: "Ya fue procesada." }, { status: 409 });
  }

  const session = await auth();
  const isAdmin = session!.user.role === "admin";
  const updated = await prisma.personalPurchase.update({
    where: { id },
    data: { status: "REJECTED", rejectedAt: new Date(), rejectedById: isAdmin ? null : session!.user.id, rejectionReason: parsed.data.reason },
  });

  await sendPushToOwner(purchase.employee.id, {
    title: "❌ Tu compra personal fue rechazada",
    body: parsed.data.reason,
    url: "/area/compras-personales",
  }).catch(() => null);

  return NextResponse.json(updated);
}
