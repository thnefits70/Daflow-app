import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { canRegisterPurchaseInvoices } from "@/lib/guards";
import { sendPushToOwner } from "@/lib/webPush";

const schema = z.object({ paymentProofUrl: z.string().url() });

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!(await canRegisterPurchaseInvoices()) || !session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { id } = await params;
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Datos inválidas." }, { status: 400 });

  const existing = await prisma.purchaseRequest.findUnique({ where: { id }, include: { catalogItem: { select: { name: true } } } });
  if (!existing) return NextResponse.json({ error: "No encontrada." }, { status: 404 });
  if (existing.status !== "APPROVED") return NextResponse.json({ error: "Solo se puede pagar una solicitud ya aprobada." }, { status: 409 });

  const updated = await prisma.purchaseRequest.update({
    where: { id },
    data: { status: "PAID", paidAt: new Date(), paymentProofUrl: parsed.data.paymentProofUrl },
  });

  // Confirmado 2026-07-30: cada quien recibe solo lo que le toca — Inventario
  // se entera de que debe esperar la mercadería, y quien pidió se entera de
  // que ya se pagó.
  const inventarioLeader = await prisma.user.findFirst({
    where: { isLeader: true, leadsDept: { code: "INV" } },
    select: { id: true },
  });
  const notifyTargets = new Set<string>(["admin"]);
  if (inventarioLeader) notifyTargets.add(inventarioLeader.id);
  if (existing.requestedById) notifyTargets.add(existing.requestedById);

  await Promise.all(
    [...notifyTargets].map((ownerId) =>
      sendPushToOwner(ownerId, {
        title: ownerId === existing.requestedById ? "Tu solicitud ya fue pagada" : "Mercadería pagada — en camino",
        body: `${existing.catalogItem.name} — ${existing.quantity} un.`,
        url: ownerId === inventarioLeader?.id ? "/area/control-de-compras" : "/admin/control-de-compras",
      }).catch(() => null)
    )
  );

  return NextResponse.json(updated);
}
