import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { canConfirmPurchaseReceiving } from "@/lib/guards";
import { sendPushToOwner } from "@/lib/webPush";

const schema = z.object({
  receivedQuantity: z.number().int().nonnegative(),
  photoUrl: z.string().url(),
  comment: z.string().trim().optional(),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!(await canConfirmPurchaseReceiving()) || !session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { id } = await params;
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });

  const existing = await prisma.purchaseRequest.findUnique({ where: { id }, include: { catalogItem: { select: { name: true } } } });
  if (!existing) return NextResponse.json({ error: "No encontrada." }, { status: 404 });
  if (existing.status !== "PAID") return NextResponse.json({ error: "Todavía no está pagada." }, { status: 409 });

  const isAdmin = session.user.role === "admin";
  const [, updated] = await prisma.$transaction([
    prisma.purchaseRequestReceipt.create({
      data: {
        requestId: id,
        receivedQuantity: parsed.data.receivedQuantity,
        photoUrl: parsed.data.photoUrl,
        comment: parsed.data.comment || null,
        confirmedById: isAdmin ? null : session.user.id,
      },
    }),
    prisma.purchaseRequest.update({ where: { id }, data: { status: "RECEIVED" } }),
  ]);

  if (existing.requestedById) {
    await sendPushToOwner(existing.requestedById, {
      title: "Mercadería recibida",
      body: `${existing.catalogItem.name} — Inventario confirmó ${parsed.data.receivedQuantity} un. recibidas`,
      url: "/area/workspace",
    }).catch(() => null);
  }

  return NextResponse.json(updated);
}
