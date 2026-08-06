import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { sendPushToOwner } from "@/lib/webPush";

const schema = z.object({ note: z.string().trim().optional() });

// Confirmado 2026-08-06: un clic del admin cuando la cuenta bancaria elegida
// no sirve para pagar (datos mal, el banco rechaza la transferencia) — avisa
// a quien solicitó la compra para que cambie o elija otra cuenta ya
// registrada del proveedor.
export async function POST(req: NextRequest, { params }: { params: Promise<{ groupId: string }> }) {
  const session = await auth();
  if (!session || session.user.role !== "admin") return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { groupId } = await params;
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });

  const existing = await prisma.purchaseRequest.findFirst({
    where: { groupId },
    select: { catalogItem: { select: { name: true } }, requestedById: true },
  });
  if (!existing) return NextResponse.json({ error: "No encontrada." }, { status: 404 });

  await prisma.purchaseRequest.updateMany({
    where: { groupId },
    data: {
      bankAccountChangeRequestedAt: new Date(),
      bankAccountChangeNote: parsed.data.note || null,
      bankAccountChangeRequestedById: null,
    },
  });

  if (existing.requestedById) {
    await sendPushToOwner(existing.requestedById, {
      title: "🏦 Cambia la cuenta bancaria para pagar",
      body: `${existing.catalogItem.name}${parsed.data.note ? ` — ${parsed.data.note}` : ""}`,
      url: "/area/workspace",
    }).catch(() => null);
  }

  const updated = await prisma.purchaseRequest.findMany({ where: { groupId } });
  return NextResponse.json(updated);
}
