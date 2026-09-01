import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canAssignExternalSalePack } from "@/lib/guards";

// Ventas que Inventario ya agrupó y fotografió, todavía sin asignar a
// alguien del equipo de Fulfilment — exclusivo de Yair.
export async function GET() {
  if (!(await canAssignExternalSalePack())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  const [sales, team] = await Promise.all([
    prisma.externalSale.findMany({
      where: { prepReadyAt: { not: null }, packAssignedToId: null, deletedAt: null },
      include: { catalogItem: { select: { name: true, photos: true, justCode: true } }, advisor: { select: { name: true } } },
      orderBy: { prepReadyAt: "asc" },
    }),
    prisma.user.findMany({ where: { department: { code: "FUL" } }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  return NextResponse.json({ sales, team });
}
