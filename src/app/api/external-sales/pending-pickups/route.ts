import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canCaptureMerchandiseOutflow } from "@/lib/guards";

// Garantías locales ya entregadas al motorizado con algo por traer a bodega.
export async function GET() {
  if (!(await canCaptureMerchandiseOutflow())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  const rows = await prisma.externalSale.findMany({
    where: { kind: "WARRANTY", deletedAt: null, deliveredAt: { not: null }, returnedAt: null, items: { some: { warrantyRole: "PICKUP", pickupReceivedAt: null } } },
    select: {
      id: true,
      code: true,
      clientName: true,
      pickupPersonName: true,
      deliveredAt: true,
      advisor: { select: { name: true } },
      items: { where: { warrantyRole: "PICKUP" }, select: { id: true, quantity: true, warrantyReason: true, declaredProductName: true, pickupReceivedAt: true, catalogItem: { select: { name: true, photos: true, justCode: true } } } },
    },
    orderBy: { deliveredAt: "asc" },
  });
  return NextResponse.json(rows);
}
