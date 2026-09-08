import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canSetPersonalPurchasePrice } from "@/lib/guards";
import { computeUnitPriceModes, type UnitDeclaration } from "@/lib/personalPurchases";

// Confirmado 2026-09-08: pedido explícito del usuario — al endurecer las
// reglas de precio al costo (ver personalPurchases.ts), quedaron pedidos ya
// confirmados por bodega ANTES del cambio, con unitPriceModes calculado
// bajo las reglas viejas. Como el cálculo normalmente es de una sola vez,
// esos pedidos se quedarían con el resultado viejo para siempre. Este botón
// (visible para Nairoby en la cola de "cerrar precio") lo vuelve a calcular
// con las reglas actuales — solo mientras nadie le puso precio todavía, para
// no tocar nada que ya tenga plata involucrada.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await canSetPersonalPurchasePrice())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { id } = await params;

  const order = await prisma.personalPurchaseOrder.findUnique({
    where: { id },
    include: {
      items: { include: { confirmedCatalogItem: { select: { justCode: true } } } },
    },
  });
  if (!order) return NextResponse.json({ error: "No encontrado." }, { status: 404 });
  if (order.status !== "PENDING_FINANCE") return NextResponse.json({ error: "Solo se puede recalcular mientras está pendiente de precio." }, { status: 409 });
  if (order.items.some((it) => it.costUnitPrice != null || it.dropiUnitPrice != null)) {
    return NextResponse.json({ error: "Ya se le puso precio a algún producto — no se puede recalcular." }, { status: 409 });
  }

  for (const it of order.items) {
    if (!it.confirmedProductName) continue;
    const declarations = (Array.isArray(it.unitDeclarations) ? it.unitDeclarations : []) as unknown as UnitDeclaration[];
    const unitPriceModes = await computeUnitPriceModes(order.employeeId, it.confirmedProductName, it.quantity, declarations, it.confirmedCatalogItem?.justCode ?? null, it.id);
    await prisma.personalPurchaseItem.update({ where: { id: it.id }, data: { unitPriceModes } });
  }

  return NextResponse.json({ ok: true });
}
