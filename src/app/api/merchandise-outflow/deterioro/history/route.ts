import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canManageOutflowPurchaseGestion, canViewMerchandiseOutflow } from "@/lib/guards";

// Confirmado 2026-09-23, pedido de Daniel: seguimiento completo de cada
// producto reportado como deterioro — desde el reporte, su decisión, hasta
// lo que Jariel resolvió con el proveedor. Antes, una vez escalado, Daniel
// no veía nada más en DAFLOW y tenía que preguntar por WhatsApp si el
// proveedor aprobó. Solo lectura. Lo ve el equipo de Inventario/admin
// (Registro de Egresos) y quien gestiona con proveedores (Jariel, desde
// Compras → Reportes urgentes).
export async function GET() {
  if (!(await canViewMerchandiseOutflow()) && !(await canManageOutflowPurchaseGestion())) {
    return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  }
  const items = await prisma.merchandiseOutflowItem.findMany({
    where: { batch: { reason: "DETERIORO", submittedAt: { not: null } } },
    orderBy: { createdAt: "desc" },
    take: 300,
    select: {
      id: true,
      declaredName: true,
      quantity: true,
      photoUrls: true,
      damageReasonOther: true,
      damageReason: { select: { name: true } },
      catalogItem: { select: { name: true, justCode: true } },
      batch: { select: { code: true, createdAt: true, submittedAt: true, createdBy: { select: { name: true } }, supplier: { select: { name: true } }, documentPhotoUrls: true } },
      resolution: true,
      resolutionNote: true,
      resolvedAt: true,
      resolvedBy: { select: { name: true } },
      purchaseGestionSupplier: { select: { name: true } },
      linkedPurchaseRequestId: true,
      expectedCreditAmount: true,
      purchaseNoMatchReportedAt: true,
      purchaseNoMatchNote: true,
      purchaseNoMatchReportedBy: { select: { name: true } },
      purchaseExceptionDecision: true,
      purchaseExceptionNote: true,
      purchaseExceptionDecidedAt: true,
      purchaseExceptionDecidedBy: { select: { name: true } },
      purchaseResolution: true,
      purchaseResolutionNote: true,
      purchaseResolvedAt: true,
      purchaseResolvedBy: { select: { name: true } },
      credit: { select: { amount: true } },
      exchangeItem: { select: { batch: { select: { code: true, submittedAt: true } } } },
    },
  });
  return NextResponse.json(items);
}
