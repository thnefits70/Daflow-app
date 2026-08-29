import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getMarketingLeadId } from "@/lib/guards";

const ITEM_INCLUDE = {
  catalogItem: { select: { name: true, photos: true, justCode: true } },
  linkedPurchaseRequest: { select: { requestNumber: true, requestedAt: true } },
} as const;

// Confirmado 2026-08-26, pedido explícito del usuario: "mis pendientes" de
// Cambio con proveedor — cualquier usuario autenticado (no un rol/guard fijo)
// que sea quien solicitó originalmente la compra de un producto que está
// siendo cambiado (linkedPurchaseRequest.requestedById), o Bryan (líder de
// Análisis de Mercado) como responsable de respaldo para los productos sin
// compra vinculada. Sin gate de departamento a propósito — el gestor puede
// no tener ningún otro acceso a Registro de Egresos, por eso esto vive en
// una página standalone (/area/cambio-proveedor-gestiones), no en el
// workspace — mismo criterio que /area/compras-personales.
export async function GET() {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const marketingLeadId = await getMarketingLeadId();
  const or: Record<string, unknown>[] = [{ linkedPurchaseRequest: { requestedById: session.user.id } }];
  if (marketingLeadId === session.user.id) or.push({ linkedPurchaseRequestId: null });

  const items = await prisma.merchandiseOutflowItem.findMany({
    where: { batch: { reason: "CAMBIO_PROVEEDOR", submittedAt: { not: null } }, resolution: null, OR: or },
    include: {
      ...ITEM_INCLUDE,
      batch: { select: { id: true, code: true, createdAt: true, documentPhotoUrls: true, supplier: { select: { id: true, name: true } } } },
    },
    orderBy: { createdAt: "asc" },
  });
  return NextResponse.json(items);
}
