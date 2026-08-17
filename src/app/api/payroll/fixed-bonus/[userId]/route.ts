import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { canProposeFixedMonthlyBonus } from "@/lib/guards";
import { sendPushToOwner } from "@/lib/webPush";
import { actorName } from "@/lib/actorName";

const schema = z.object({ pendingAmount: z.number().nonnegative() });

// Confirmado 2026-08-17: Nairoby (o admin) propone un monto — nunca queda
// activo directo, siempre como pendingAmount hasta que el admin lo apruebe
// (POST .../approve). Mismo patrón que las comisiones de equipo.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ userId: string }> }) {
  if (!(await canProposeFixedMonthlyBonus())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { userId } = await params;
  const session = await auth();
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, name: true } });
  if (!user) return NextResponse.json({ error: "No encontrado." }, { status: 404 });

  const isAdmin = session!.user.role === "admin";
  const bonus = await prisma.fixedMonthlyBonus.upsert({
    where: { userId },
    update: { pendingAmount: parsed.data.pendingAmount, proposedAt: new Date(), proposedById: isAdmin ? null : session!.user.id },
    create: { userId, pendingAmount: parsed.data.pendingAmount, proposedAt: new Date(), proposedById: isAdmin ? null : session!.user.id },
  });

  await sendPushToOwner("admin", {
    title: "💰 Bono especial fijo propuesto — falta tu aprobación",
    body: `${user.name} · $${parsed.data.pendingAmount.toFixed(2)}/mes · propuesto por ${actorName(session!.user.name)}`,
    url: "/admin/nomina?tab=pagos",
  }).catch(() => null);

  return NextResponse.json(bonus);
}
