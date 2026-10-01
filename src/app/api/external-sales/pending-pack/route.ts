import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canAssignExternalSalePack } from "@/lib/guards";

// Ventas que ya se agruparon y fotografiaron, todavía sin asignar a alguien
// que las embale y entregue — exclusivo del Líder de Inventarios. Desde
// 2026-10-01 (Fulfillment fusionado en INVESTOCK) el equipo es el de INV, sin
// el líder: él asigna, nunca entrega él mismo.
export async function GET() {
  if (!(await canAssignExternalSalePack())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  const [sales, team] = await Promise.all([
    prisma.externalSale.findMany({
      where: { prepReadyAt: { not: null }, packAssignedToId: null, deletedAt: null },
      include: {
        items: { include: { catalogItem: { select: { name: true, photos: true, justCode: true } } }, orderBy: { createdAt: "asc" } },
        advisor: { select: { name: true } },
        guidePrintedBy: { select: { name: true } },
      },
      orderBy: { prepReadyAt: "asc" },
    }),
    prisma.user.findMany({ where: { department: { code: "INV" }, isActive: true, isLeader: false }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  return NextResponse.json({ sales, team });
}
