import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canActOnMerchandiseOutflow } from "@/lib/guards";

// Ventas aprobadas por Bryan, todavía sin asignar a un colaborador de
// Inventario — exclusivo de Daniel. Confirmado 2026-09-21: ya no espera a
// que Nairoby facture primero en pago anticipado — eso hacía esperar al
// cliente por puro papeleo. La factura ahora solo bloquea el cierre de
// Nairoby (ver close/route.ts), no el despacho ni la entrega.
//
// 2026-10-01, pedido de Marcos (aprobado por el usuario): también devuelve
// las ya asignadas que todavía no se agrupan (`inProgress`), para que Daniel
// pueda reasignarlas si la persona no avanza — él sigue sin agruparlas él
// mismo, así cada paso queda a nombre de quien lo hizo.
export async function GET() {
  if (!(await canActOnMerchandiseOutflow())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  const include = {
    items: { include: { catalogItem: { select: { name: true, photos: true, justCode: true } } }, orderBy: { createdAt: "asc" as const } },
    advisor: { select: { name: true } },
  };
  const [sales, inProgress, team] = await Promise.all([
    prisma.externalSale.findMany({
      where: {
        reviewStatus: "APPROVED",
        dispatchAssignedToId: null,
        deletedAt: null,
      },
      include,
      orderBy: { reviewedAt: "asc" },
    }),
    prisma.externalSale.findMany({
      where: { reviewStatus: "APPROVED", dispatchAssignedToId: { not: null }, prepReadyAt: null, deletedAt: null },
      include: { ...include, dispatchAssignedTo: { select: { id: true, name: true } } },
      orderBy: { dispatchAssignedAt: "asc" },
    }),
    prisma.user.findMany({ where: { department: { code: "INV" }, isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  return NextResponse.json({ sales, inProgress, team });
}
