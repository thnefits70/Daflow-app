import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { canConfirmPersonalPurchaseInventory } from "@/lib/guards";
import { sendPushToOwner } from "@/lib/webPush";
import { actorName } from "@/lib/actorName";

// Confirmado 2026-08-18: la confirmación de Daniel es lo que habilita el
// retiro físico de bodega — no activa el descuento todavía, eso lo hace
// Nairoby/admin después con confirm-finance.
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await canConfirmPersonalPurchaseInventory())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const session = await auth();
  const { id } = await params;
  const purchase = await prisma.personalPurchase.findUnique({ where: { id }, include: { employee: { select: { name: true, id: true } }, product: { select: { name: true } } } });
  if (!purchase) return NextResponse.json({ error: "No encontrada." }, { status: 404 });
  if (purchase.status !== "PENDING_INVENTORY") return NextResponse.json({ error: "Ya fue procesada." }, { status: 409 });

  const isAdmin = session!.user.role === "admin";
  const updated = await prisma.personalPurchase.update({
    where: { id },
    data: { status: "PENDING_FINANCE", inventoryConfirmedAt: new Date(), inventoryConfirmedById: isAdmin ? null : session!.user.id },
  });

  const finLeader = await prisma.user.findFirst({ where: { isLeader: true, leadsDept: { code: "FIN" } }, select: { id: true } });
  if (finLeader) {
    await sendPushToOwner(finLeader.id, {
      title: "🛒 Compra personal confirmada por bodega — falta fijar el precio",
      body: `${purchase.employee.name} · ${purchase.product.name} · confirmado por ${actorName(isAdmin ? null : session!.user.name)}`,
      url: "/area/nomina?tab=pagos&ptab=comprasfinanzas",
    }).catch(() => null);
  }
  await sendPushToOwner(purchase.employee.id, {
    title: "✅ Tu compra personal fue confirmada",
    body: `${purchase.product.name} — ya podés retirarlo de bodega.`,
    url: "/area/compras-personales",
  }).catch(() => null);

  return NextResponse.json(updated);
}
