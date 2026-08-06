import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { canSubmitPurchaseRequests } from "@/lib/guards";
import { sendPushToOwner } from "@/lib/webPush";

const schema = z.object({ bankAccountId: z.string().min(1) });

// Confirmado 2026-08-06: quien solicitó la compra puede cambiar la cuenta
// bancaria del proveedor elegida en cualquier momento (no solo al pedir) —
// típicamente en respuesta a que el admin avisó que la cuenta actual no
// sirvió para pagar. Cambiar la cuenta limpia ese aviso y notifica a admin
// que ya puede intentar de nuevo.
export async function POST(req: NextRequest, { params }: { params: Promise<{ groupId: string }> }) {
  if (!(await canSubmitPurchaseRequests())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { groupId } = await params;
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });

  const existing = await prisma.purchaseRequest.findFirst({ where: { groupId }, select: { catalogItem: { select: { name: true } } } });
  if (!existing) return NextResponse.json({ error: "No encontrada." }, { status: 404 });

  await prisma.purchaseRequest.updateMany({
    where: { groupId },
    data: {
      bankAccountId: parsed.data.bankAccountId,
      bankAccountChangeRequestedAt: null,
      bankAccountChangeNote: null,
      bankAccountChangeRequestedById: null,
    },
  });

  await sendPushToOwner("admin", {
    title: "🏦 Cuenta bancaria actualizada",
    body: `${existing.catalogItem.name} — ya puedes intentar pagar de nuevo`,
    url: "/admin",
  }).catch(() => null);

  const updated = await prisma.purchaseRequest.findMany({ where: { groupId } });
  return NextResponse.json(updated);
}
