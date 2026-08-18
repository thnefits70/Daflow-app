import { NextRequest, NextResponse } from "next/server";
import { canConfirmPurchaseReceiving } from "@/lib/guards";
import { prisma } from "@/lib/prisma";

// Confirmado 2026-08-06: Daniel (líder de Inventario) necesita ver los
// cambios de mercadería que Bryan coordinó con el proveedor, para
// verificarlos cuando lleguen — sin acceso a la bandeja completa de
// "Reportes urgentes" (esa es de quien coordina con el proveedor).
export async function GET(_req: NextRequest) {
  if (!(await canConfirmPurchaseReceiving())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const resolutions = await prisma.purchaseUrgentResolution.findMany({
    where: { type: "REPLACEMENT", status: "PENDING" },
    orderBy: { replacementDueDate: "asc" },
    include: {
      replacementSubmittedBy: { select: { name: true } },
      report: {
        include: {
          request: {
            select: { id: true, deptId: true, catalogItem: { select: { name: true, photos: true } }, supplier: { select: { name: true } } },
          },
        },
      },
    },
  });

  return NextResponse.json(resolutions);
}
