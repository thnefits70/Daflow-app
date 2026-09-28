import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canDecidePurchaseException } from "@/lib/guards";

// Confirmado 2026-09-28, pedido explícito del usuario: reclamos que Jariel
// pidió cerrar SIN captura con CHEN, esperando aprobación de admin (ver
// purchase-no-proof-request/route.ts). Junto a cada uno va lo necesario para
// ver si se está repitiendo lo mismo: otros reclamos de daño del MISMO
// producto con ese proveedor, créditos que ya se dieron por ese producto, y
// cuántos pedidos sin captura lleva el proveedor en los últimos 30 días.
export async function GET() {
  const session = await auth();
  if (!session || !(await canDecidePurchaseException())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const items = await prisma.merchandiseOutflowItem.findMany({
    where: { noProofRequestedAt: { not: null }, noProofDecidedAt: null, purchaseResolution: null },
    include: {
      catalogItem: { select: { name: true, photos: true, justCode: true } },
      batch: { select: { code: true } },
      purchaseGestionSupplier: { select: { id: true, name: true } },
      noProofRequestedBy: { select: { name: true } },
      linkedPurchaseRequest: { select: { requestedAt: true, unitCost: true } },
    },
    orderBy: { noProofRequestedAt: "asc" },
  });

  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const result = await Promise.all(
    items.map(async (item) => {
      const supplierId = item.purchaseGestionSupplierId;
      // Mismo producto: por catálogo si lo tiene, si no por el nombre declarado.
      const sameProduct = item.catalogItemId ? { catalogItemId: item.catalogItemId } : { declaredName: item.declaredName };
      const [otherClaims, previousCredits, recentNoProofCount] = await Promise.all([
        prisma.merchandiseOutflowItem.findMany({
          where: {
            id: { not: item.id },
            ...sameProduct,
            OR: supplierId ? [{ purchaseGestionSupplierId: supplierId }, { batch: { supplierId } }] : undefined,
          },
          select: {
            id: true,
            quantity: true,
            purchaseResolution: true,
            resolution: true,
            noProofRequestedAt: true,
            batch: { select: { code: true, reason: true, createdAt: true } },
          },
          orderBy: { batch: { createdAt: "desc" } },
          take: 10,
        }),
        supplierId
          ? prisma.supplierCredit.findMany({
              where: {
                supplierId,
                status: { not: "CANCELLED" },
                OR: [{ outflowItem: sameProduct }, { groupedOutflowItems: { some: sameProduct } }],
              },
              select: { id: true, amount: true, createdAt: true, reason: true, proofUrl: true },
              orderBy: { createdAt: "desc" },
              take: 10,
            })
          : [],
        supplierId
          ? prisma.merchandiseOutflowItem.count({
              where: { id: { not: item.id }, purchaseGestionSupplierId: supplierId, noProofRequestedAt: { gte: since } },
            })
          : 0,
      ]);
      return { ...item, otherClaims, previousCredits, recentNoProofCount };
    }),
  );

  return NextResponse.json(result);
}
