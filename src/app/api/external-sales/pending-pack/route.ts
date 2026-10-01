import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canAssignExternalSalePack } from "@/lib/guards";

// Ventas que ya se agruparon y fotografiaron, todavía sin asignar a alguien
// que las embale y entregue — exclusivo del Líder de Inventarios. Desde
// 2026-10-01 (Fulfillment fusionado en INVESTOCK) el equipo es el de INV, sin
// el líder: él asigna, nunca entrega él mismo.
//
// 2026-10-01, pedido de Marcos (aprobado por el usuario): también devuelve
// las ya asignadas que todavía no se entregan (`inProgress`) para que el
// líder pueda reasignarlas si la persona no avanza.
export async function GET() {
  if (!(await canAssignExternalSalePack())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  const include = {
    items: { include: { catalogItem: { select: { name: true, photos: true, justCode: true } } }, orderBy: { createdAt: "asc" as const } },
    advisor: { select: { name: true } },
    guidePrintedBy: { select: { name: true } },
  };
  const [sales, inProgress, team] = await Promise.all([
    prisma.externalSale.findMany({
      where: { prepReadyAt: { not: null }, packAssignedToId: null, deletedAt: null },
      include,
      orderBy: { prepReadyAt: "asc" },
    }),
    prisma.externalSale.findMany({
      where: { packAssignedToId: { not: null }, deliveredAt: null, returnedAt: null, deletedAt: null },
      include: { ...include, packAssignedTo: { select: { id: true, name: true } } },
      orderBy: { packAssignedAt: "asc" },
    }),
    prisma.user.findMany({ where: { department: { code: "INV" }, isActive: true, isLeader: false }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  return NextResponse.json({ sales, inProgress, team });
}
