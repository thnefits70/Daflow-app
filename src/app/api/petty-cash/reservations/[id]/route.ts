import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { canManagePettyCashPrincipal, canManagePettyCashSecundaria } from "@/lib/guards";
import { prisma } from "@/lib/prisma";

// "Ya no se necesita" — libera lo apartado sin borrarlo (queda como
// cancelado, con quién y cuándo, para la auditoría).
export async function PATCH(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  if (session.user.role === "admin") return NextResponse.json({ error: "Esto lo hace quien administra la caja." }, { status: 403 });

  const { id } = await ctx.params;
  const r = await prisma.pettyCashReservation.findUnique({ where: { id }, include: { box: { select: { type: true } } } });
  if (!r) return NextResponse.json({ error: "No encontrado." }, { status: 404 });
  if (r.releasedAt) return NextResponse.json({ error: "Esto ya se había liberado." }, { status: 409 });

  const authorized = r.box.type === "PRINCIPAL" ? await canManagePettyCashPrincipal() : await canManagePettyCashSecundaria();
  if (!authorized) return NextResponse.json({ error: "No autorizado para esta caja." }, { status: 403 });

  await prisma.pettyCashReservation.update({
    where: { id },
    data: { releasedAt: new Date(), releasedById: session.user.id, releaseReason: "cancelled" },
  });
  return NextResponse.json({ ok: true });
}
