import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canReceivePurchasesTeam } from "@/lib/guards";
import { formatPurchaseRequestCode } from "@/lib/purchases";

// Confirmado 2026-08-25: al reportar un reclamo posterior al cierre,
// Inventario elige de cuál solicitud de compra (ya RECIBIDA) cree que viene
// físicamente lo dañado — mismo producto+proveedor, más reciente primero. Si
// no puede saberlo ("mercadería mezclada"), el cliente usa averageUnitCost
// en vez del unitCost de una solicitud puntual.
export async function GET(req: NextRequest) {
  if (!(await canReceivePurchasesTeam())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const catalogItemId = req.nextUrl.searchParams.get("catalogItemId");
  const supplierId = req.nextUrl.searchParams.get("supplierId");
  if (!catalogItemId || !supplierId) return NextResponse.json({ error: "Faltan parámetros." }, { status: 400 });

  const rows = await prisma.purchaseRequest.findMany({
    where: { catalogItemId, supplierId, status: "RECEIVED" },
    orderBy: { receipt: { confirmedAt: "desc" } },
    take: 10,
    select: { id: true, requestNumber: true, quantity: true, unitCost: true, totalCost: true, receipt: { select: { confirmedAt: true } } },
  });

  const candidates = rows.map((r) => ({
    id: r.id,
    code: r.requestNumber ? formatPurchaseRequestCode(r.requestNumber) : null,
    quantity: r.quantity,
    unitCost: r.unitCost,
    totalCost: r.totalCost,
    receivedAt: r.receipt?.confirmedAt?.toISOString() ?? null,
  }));

  const averageUnitCost = rows.length > 0 ? rows.reduce((s, r) => s + r.unitCost, 0) / rows.length : null;

  return NextResponse.json({ candidates, averageUnitCost });
}
