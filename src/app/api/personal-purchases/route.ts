import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { computePurchasePrice } from "@/lib/personalPurchases";
import { nowInEcuador } from "@/lib/payrollCalc";
import { sendPushToOwner } from "@/lib/webPush";
import { actorName } from "@/lib/actorName";

function currentMonthStr(): string {
  const d = nowInEcuador();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

// Historial propio del colaborador que está logueado.
export async function GET() {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  if (session.user.role === "admin") return NextResponse.json([]);

  const purchases = await prisma.personalPurchase.findMany({
    where: { employeeId: session.user.id },
    include: { product: { select: { name: true, photo: true } } },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json(purchases);
}

const schema = z.object({
  productId: z.string().min(1),
  quantity: z.number().int().positive(),
  livePhotoUrl: z.string().min(1),
  buyerRelation: z.enum(["SELF", "MINOR_CHILD", "OTHER_FAMILY"]),
  buyerNote: z.string().optional(),
  installments: z.number().int().min(1).max(2),
});

// Confirmado 2026-08-18: cualquier colaborador puede pedir esto, sin guard
// especial — el precio se recalcula server-side (nunca se confía en lo que
// mande el cliente) para que nadie pueda manipular el monto.
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session || session.user.role === "admin") return NextResponse.json({ error: "No autorizado." }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });

  if (parsed.data.buyerRelation !== "SELF" && !parsed.data.buyerNote?.trim()) {
    return NextResponse.json({ error: "Contá para quién es la compra." }, { status: 400 });
  }

  const { priceMode, unitPrice } = await computePurchasePrice(session.user.id, parsed.data.productId, parsed.data.buyerRelation);
  const totalAmount = unitPrice * parsed.data.quantity;
  if (parsed.data.installments === 2 && totalAmount < 25) {
    return NextResponse.json({ error: "Solo se puede pagar en 2 cuotas si el total es de $25 o más." }, { status: 400 });
  }

  const purchase = await prisma.personalPurchase.create({
    data: {
      employeeId: session.user.id,
      productId: parsed.data.productId,
      quantity: parsed.data.quantity,
      livePhotoUrl: parsed.data.livePhotoUrl,
      buyerRelation: parsed.data.buyerRelation,
      buyerNote: parsed.data.buyerNote?.trim(),
      priceMode,
      unitPrice,
      totalAmount,
      installments: parsed.data.installments,
      eventMonth: currentMonthStr(),
    },
    include: { product: { select: { name: true } } },
  });

  const invLeader = await prisma.user.findFirst({ where: { isLeader: true, leadsDept: { code: "INV" } }, select: { id: true } });
  if (invLeader) {
    await sendPushToOwner(invLeader.id, {
      title: "🛒 Nueva compra personal — falta confirmar",
      body: `${actorName(session.user.name)} · ${purchase.product.name} × ${purchase.quantity} · $${totalAmount.toFixed(2)}`,
      url: "/area/compras-personales",
    }).catch(() => null);
  }

  return NextResponse.json(purchase, { status: 201 });
}
