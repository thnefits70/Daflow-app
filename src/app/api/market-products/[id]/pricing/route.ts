import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { canEditMarketProductPricing } from "@/lib/guards";
import { computeMarketProductSalePrice, pickPrimarySupplierPrice } from "@/lib/marketProduct";

const schema = z.object({
  insuranceRatePercent: z.number().min(0).max(100).optional(),
  fulfillmentCost: z.number().nonnegative().optional(),
  marginPercent: z.number().min(0).max(99).optional(),
});

// Confirmado con el usuario en la planificación de esta fase: después de
// aprobada, SOLO quien la propuso (Jariel) o admin puede ajustar margen/
// fulfillment/seguro — el costo de compra en sí (supplierPrices) nunca se
// toca acá. Cada cambio queda en MarketProductPriceChange.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { id } = await params;
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });
  if (!parsed.data.insuranceRatePercent && !parsed.data.fulfillmentCost && !parsed.data.marginPercent) {
    return NextResponse.json({ error: "No hay ningún cambio que guardar." }, { status: 400 });
  }

  const existing = await prisma.marketProductProposal.findUnique({
    where: { id },
    include: { supplierPrices: true },
  });
  if (!existing) return NextResponse.json({ error: "No encontrada." }, { status: 404 });
  if (!(await canEditMarketProductPricing(existing.proposedById))) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const primary = pickPrimarySupplierPrice(existing.supplierPrices);
  if (!primary) return NextResponse.json({ error: "Falta el proveedor principal." }, { status: 409 });

  const nextValues = {
    insuranceRatePercent: parsed.data.insuranceRatePercent ?? existing.insuranceRatePercent,
    fulfillmentCost: parsed.data.fulfillmentCost ?? existing.fulfillmentCost,
    marginPercent: parsed.data.marginPercent ?? existing.marginPercent,
  };

  const calculatedSalePrice = computeMarketProductSalePrice({
    batchCost: primary.batchCost,
    batchUnits: primary.batchUnits,
    freightCost: primary.freightCost,
    ...nextValues,
  });

  const changes: { field: string; oldValue: number; newValue: number }[] = [];
  (["insuranceRatePercent", "fulfillmentCost", "marginPercent"] as const).forEach((field) => {
    if (parsed.data[field] !== undefined && parsed.data[field] !== existing[field]) {
      changes.push({ field, oldValue: existing[field], newValue: parsed.data[field]! });
    }
  });

  const isAdmin = session.user.role === "admin";
  const [updated] = await prisma.$transaction([
    prisma.marketProductProposal.update({ where: { id }, data: { ...nextValues, calculatedSalePrice } }),
    ...(changes.length > 0
      ? [
          prisma.marketProductPriceChange.createMany({
            data: changes.map((c) => ({ proposalId: id, field: c.field, oldValue: c.oldValue, newValue: c.newValue, changedById: isAdmin ? null : session.user.id })),
          }),
        ]
      : []),
  ]);

  return NextResponse.json(updated);
}
