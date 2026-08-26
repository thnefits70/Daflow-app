import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canActOnMerchandiseOutflow, getMarketingLeadId } from "@/lib/guards";

const ITEM_INCLUDE = {
  catalogItem: { select: { name: true, photos: true } },
  linkedPurchaseRequest: { select: { requestNumber: true, requestedAt: true, requestedBy: { select: { name: true } } } },
  credit: { select: { amount: true } },
} as const;

// Confirmado 2026-08-26: vista de SOLO LECTURA para Daniel/admin — quien
// resuelve cada producto (cambio o crédito) ya no es Daniel, es quien
// solicitó esa compra originalmente (ver resolve-supplier/route.ts y
// /area/cambio-proveedor-gestiones). Muestra pendientes Y resueltos, con el
// nombre del responsable, para la trazabilidad que pidió el usuario.
export async function GET() {
  const session = await auth();
  const isAdmin = session?.user.role === "admin";
  if (!session || !(isAdmin || (await canActOnMerchandiseOutflow()))) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const [items, marketingLeadId] = await Promise.all([
    prisma.merchandiseOutflowItem.findMany({
      where: { batch: { reason: "CAMBIO_PROVEEDOR", submittedAt: { not: null } } },
      include: {
        ...ITEM_INCLUDE,
        batch: { select: { id: true, code: true, createdAt: true, supplier: { select: { id: true, name: true } } } },
        resolvedBy: { select: { name: true } },
      },
      orderBy: { createdAt: "asc" },
    }),
    getMarketingLeadId(),
  ]);
  const marketingLead = marketingLeadId ? await prisma.user.findUnique({ where: { id: marketingLeadId }, select: { name: true } }) : null;

  const withGestor = items.map((item) => ({
    ...item,
    gestorName: item.linkedPurchaseRequest?.requestedBy?.name ?? marketingLead?.name ?? null,
  }));
  return NextResponse.json(withGestor);
}
