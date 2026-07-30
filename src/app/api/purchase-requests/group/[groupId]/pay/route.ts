import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { canRegisterPurchaseInvoices } from "@/lib/guards";
import { sendPushToOwner } from "@/lib/webPush";

const schema = z.object({ paymentProofUrl: z.string().url() });

export async function POST(req: NextRequest, { params }: { params: Promise<{ groupId: string }> }) {
  const session = await auth();
  if (!(await canRegisterPurchaseInvoices()) || !session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { groupId } = await params;
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });

  const rows = await prisma.purchaseRequest.findMany({ where: { groupId }, include: { catalogItem: { select: { name: true } } } });
  if (rows.length === 0) return NextResponse.json({ error: "No encontrada." }, { status: 404 });
  if (rows.some((r) => r.status !== "APPROVED")) {
    return NextResponse.json({ error: "Solo se puede pagar una solicitud ya aprobada." }, { status: 409 });
  }

  const paidAt = new Date();
  await prisma.purchaseRequest.updateMany({
    where: { groupId },
    data: { status: "PAID", paidAt, paymentProofUrl: parsed.data.paymentProofUrl },
  });

  const inventarioLeader = await prisma.user.findFirst({ where: { isLeader: true, leadsDept: { code: "INV" } }, select: { id: true } });
  const requestedById = rows[0].requestedById;
  const names = rows.map((r) => r.catalogItem.name).join(", ");
  const notifyTargets = new Set<string>(["admin"]);
  if (inventarioLeader) notifyTargets.add(inventarioLeader.id);
  if (requestedById) notifyTargets.add(requestedById);

  await Promise.all(
    [...notifyTargets].map((ownerId) =>
      sendPushToOwner(ownerId, {
        title: ownerId === requestedById ? "Tu solicitud ya fue pagada" : "Mercadería pagada — en camino",
        body: names,
        url: ownerId === inventarioLeader?.id || ownerId === requestedById ? "/area/workspace" : "/admin",
      }).catch(() => null)
    )
  );

  const updated = await prisma.purchaseRequest.findMany({ where: { groupId } });
  return NextResponse.json(updated);
}
