import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { canProposeCommissionAmounts } from "@/lib/guards";
import { sendPushToOwner } from "@/lib/webPush";
import { actorName } from "@/lib/actorName";

const schema = z.object({ pendingAmount: z.number().nonnegative() });

// Confirmado 2026-08-14: Nairoby (o admin) propone un monto — nunca queda
// activo directo, siempre como pendingAmount hasta que el admin lo apruebe
// (POST .../approve). Avisa al admin de inmediato, mismo patrón que ya usa
// "Horas extra por aprobar".
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ tierId: string; userId: string }> }) {
  if (!(await canProposeCommissionAmounts())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { tierId, userId } = await params;
  const session = await auth();
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });

  const [tier, user] = await Promise.all([
    prisma.commissionTier.findUnique({ where: { id: tierId } }),
    prisma.user.findUnique({ where: { id: userId }, select: { id: true, name: true } }),
  ]);
  if (!tier || !user) return NextResponse.json({ error: "No encontrado." }, { status: 404 });

  const isAdmin = session!.user.role === "admin";
  const amountRow = await prisma.commissionTierAmount.upsert({
    where: { tierId_userId: { tierId, userId } },
    update: { pendingAmount: parsed.data.pendingAmount, proposedAt: new Date(), proposedById: isAdmin ? null : session!.user.id },
    create: { tierId, userId, pendingAmount: parsed.data.pendingAmount, proposedAt: new Date(), proposedById: isAdmin ? null : session!.user.id },
  });

  await sendPushToOwner("admin", {
    title: "💰 Comisión propuesta — falta tu aprobación",
    body: `${user.name} · ${tier.name} · $${parsed.data.pendingAmount.toFixed(2)} · propuesto por ${actorName(session!.user.name)}`,
    url: "/admin/nomina?tab=pagos",
  }).catch(() => null);

  return NextResponse.json(amountRow);
}
