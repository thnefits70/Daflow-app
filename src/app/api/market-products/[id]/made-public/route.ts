import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { canPublishMarketProduct } from "@/lib/guards";
import { notifyOwner } from "@/lib/notifications";

// Aprobado por Bryan 2026-10-10: la asesora B2B confirma que ya cambió a
// público en Dropi el producto que Bryan pidió (ver request-public).
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!(await canPublishMarketProduct()) || !session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { id } = await params;
  const existing = await prisma.marketProductProposal.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "No encontrada." }, { status: 404 });
  if (!existing.publicRequestedAt || existing.madePublicAt) return NextResponse.json({ error: "No hay nada pendiente para este producto." }, { status: 409 });

  const updated = await prisma.marketProductProposal.update({
    where: { id },
    data: { isPublic: true, madePublicAt: new Date(), madePublicById: session.user.id },
  });

  const marketingLead = await prisma.user.findFirst({ where: { isLeader: true, leadsDept: { code: "MKT" } }, select: { id: true } });
  if (marketingLead) {
    await notifyOwner(marketingLead.id, {
      title: "Ya está público en Dropi",
      body: `${existing.productName} — ID ${existing.dropiProductId}`,
      url: "/area/workspace?tab=analisis-mercado&ptab=trazabilidad",
    }).catch(() => null);
  }

  return NextResponse.json(updated);
}
