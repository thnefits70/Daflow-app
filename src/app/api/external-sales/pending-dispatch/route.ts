import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canActOnMerchandiseOutflow } from "@/lib/guards";

// Ventas aprobadas por Bryan, todavía sin asignar a un colaborador de
// Inventario — exclusivo de Daniel, no depende de si el pago ya se
// confirmó (son dos pistas independientes).
export async function GET() {
  if (!(await canActOnMerchandiseOutflow())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  const [sales, team] = await Promise.all([
    prisma.externalSale.findMany({
      where: { reviewStatus: "APPROVED", dispatchAssignedToId: null },
      include: { catalogItem: { select: { name: true, photos: true } }, advisor: { select: { name: true } } },
      orderBy: { reviewedAt: "asc" },
    }),
    prisma.user.findMany({ where: { department: { code: "INV" } }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  return NextResponse.json({ sales, team });
}
