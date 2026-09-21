import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canCaptureMerchandiseOutflow, canActOnMerchandiseOutflow } from "@/lib/guards";
import { findMostRecentSupplierPurchase } from "@/lib/merchandiseOutflow";

const schema = z.object({
  catalogItemId: z.string().min(1).optional(),
  declaredName: z.string().trim().min(1).optional(),
  quantity: z.number().int().positive(),
  damageReasonName: z.string().trim().min(1).optional(),
  damageReasonOther: z.string().trim().optional(),
});

// Agrega un renglón ya confirmado (contra el catálogo, vía ProductMatchPicker
// del lado del cliente, o nombre libre) al lote — mismo patrón que Reingreso,
// cada fila se confirma antes de quedar guardada. CAMBIO_PROVEEDOR y DESPACHO
// quedan exclusivos de Daniel (canActOnMerchandiseOutflow, este último
// confirmado 2026-08-31); garantía sigue abierta a todo el equipo de Inventario.
// DETERIORO (confirmado 2026-09-21, pedido explícito del usuario/Daniel):
// cada producto lleva su propio motivo de daño — solo la foto y el proveedor
// se comparten a nivel de lote — mismo catálogo fijo de chips que ya usaba
// el reporte de un solo producto.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { id } = await params;
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });
  if (!parsed.data.catalogItemId && !parsed.data.declaredName) return NextResponse.json({ error: "Falta el producto." }, { status: 400 });

  const batch = await prisma.merchandiseOutflowBatch.findUnique({ where: { id } });
  if (!batch) return NextResponse.json({ error: "No encontrado." }, { status: 404 });
  const authorized = batch.reason === "CAMBIO_PROVEEDOR" || batch.reason === "DESPACHO" ? await canActOnMerchandiseOutflow() : await canCaptureMerchandiseOutflow();
  if (!authorized) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  if (batch.createdById !== session.user.id) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  if (batch.submittedAt) return NextResponse.json({ error: "Este lote ya fue enviado." }, { status: 409 });

  let declaredName = parsed.data.declaredName ?? "";
  if (parsed.data.catalogItemId) {
    const catalogItem = await prisma.purchaseCatalogItem.findUnique({ where: { id: parsed.data.catalogItemId }, select: { name: true } });
    if (!catalogItem) return NextResponse.json({ error: "Producto no encontrado en el catálogo." }, { status: 404 });
    declaredName = catalogItem.name;
  }

  let damageReasonId: string | null = null;
  let damageReasonOther: string | null = null;
  if (batch.reason === "DETERIORO") {
    if (!parsed.data.damageReasonName) return NextResponse.json({ error: "Falta el motivo del daño." }, { status: 400 });
    if (parsed.data.damageReasonName === "Otro") {
      if (!parsed.data.damageReasonOther) return NextResponse.json({ error: "Describe el motivo del daño." }, { status: 400 });
      damageReasonOther = parsed.data.damageReasonOther;
    } else {
      const reason = await prisma.merchandiseDamageReason.upsert({
        where: { name: parsed.data.damageReasonName },
        update: {},
        create: { name: parsed.data.damageReasonName },
      });
      damageReasonId = reason.id;
    }
  }

  let linkedPurchaseRequestId: string | null = null;
  let unitCostAtExchange: number | null = null;
  let expectedCreditAmount: number | null = null;
  if (batch.reason === "CAMBIO_PROVEEDOR" && batch.supplierId && parsed.data.catalogItemId) {
    const lastPurchase = await findMostRecentSupplierPurchase(batch.supplierId, parsed.data.catalogItemId);
    if (lastPurchase) {
      linkedPurchaseRequestId = lastPurchase.purchaseRequestId;
      unitCostAtExchange = lastPurchase.unitCost;
      expectedCreditAmount = lastPurchase.unitCost * parsed.data.quantity;
    }
  }

  const item = await prisma.merchandiseOutflowItem.create({
    data: {
      batchId: id,
      catalogItemId: parsed.data.catalogItemId ?? null,
      declaredName,
      quantity: parsed.data.quantity,
      damageReasonId,
      damageReasonOther,
      linkedPurchaseRequestId,
      unitCostAtExchange,
      expectedCreditAmount,
    },
    include: {
      catalogItem: { select: { name: true, photos: true, justCode: true } },
      damageReason: { select: { name: true } },
      linkedPurchaseRequest: { select: { requestNumber: true, requestedAt: true, requestedBy: { select: { name: true } } } },
    },
  });
  return NextResponse.json(item);
}
