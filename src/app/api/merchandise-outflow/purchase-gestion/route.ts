import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canManageOutflowPurchaseGestion } from "@/lib/guards";

// Confirmado 2026-09-17, pedido explícito del usuario: cola de reclamos de
// deterioro escalados que Jariel todavía tiene que gestionar con el
// proveedor — incluye los nunca intentados y los que admin ya autorizó a
// seguir sin compra vinculada (purchaseExceptionDecision AUTHORIZED). Los
// que están esperando una decisión de admin (purchaseNoMatchReportedAt sin
// decidir) quedan afuera — Jariel ya no puede actuar sobre esos hasta que
// admin resuelva (ver purchase-exceptions/route.ts).
export async function GET() {
  const session = await auth();
  if (!session || !(await canManageOutflowPurchaseGestion())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const items = await prisma.merchandiseOutflowItem.findMany({
    where: {
      resolution: "ESCALATED_TO_PURCHASES",
      purchaseResolution: null,
      OR: [{ purchaseNoMatchReportedAt: null }, { purchaseExceptionDecision: "AUTHORIZED" }],
    },
    include: {
      catalogItem: { select: { name: true, photos: true, justCode: true } },
      damageReason: { select: { name: true } },
      batch: { select: { code: true } },
      purchaseGestionSupplier: { select: { id: true, name: true } },
      linkedPurchaseRequest: { select: { requestNumber: true, requestedAt: true, quantity: true, unitCost: true } },
      resolvedBy: { select: { name: true } },
    },
    orderBy: { resolvedAt: "asc" },
  });

  return NextResponse.json(items);
}
