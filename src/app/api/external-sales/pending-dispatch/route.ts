import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canActOnMerchandiseOutflow } from "@/lib/guards";

// Ventas aprobadas por Bryan, todavía sin asignar a un colaborador de
// Inventario — exclusivo de Daniel. Contra entrega (Marcos) entra de una
// vez; pago anticipado espera a que Nairoby facture primero.
export async function GET() {
  if (!(await canActOnMerchandiseOutflow())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  const [sales, team] = await Promise.all([
    prisma.externalSale.findMany({
      where: {
        reviewStatus: "APPROVED",
        dispatchAssignedToId: null,
        deletedAt: null,
        OR: [{ isContraEntrega: true }, { invoiceUploadedAt: { not: null } }],
      },
      include: {
        items: { include: { catalogItem: { select: { name: true, photos: true, justCode: true } } }, orderBy: { createdAt: "asc" } },
        advisor: { select: { name: true } },
      },
      orderBy: { reviewedAt: "asc" },
    }),
    prisma.user.findMany({ where: { department: { code: "INV" } }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  return NextResponse.json({ sales, team });
}
