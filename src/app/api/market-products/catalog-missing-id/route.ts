import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { canPublishMarketProduct } from "@/lib/guards";
import { catalogMissingDropiIdWhere } from "@/lib/catalogMissingDropiId";
import { productIdUsedByCombo } from "@/lib/comboBrand";
import { DROPI_MARGIN_DEFAULT, computeMarketProductSalePrice, dropiPriceLossMessage, resolveCostBasisForCatalogItems } from "@/lib/marketProduct";

// Ver catalogMissingDropiId.ts — lista para Heidy de productos del catálogo
// sin ID de Dropi que no vienen de una propuesta de Análisis de Mercado.
export async function GET() {
  if (!(await canPublishMarketProduct())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  const items = await prisma.purchaseCatalogItem.findMany({
    where: catalogMissingDropiIdWhere,
    select: { id: true, name: true, photos: true, bodega: true, createdAt: true, createdBy: { select: { name: true } } },
    orderBy: { createdAt: "asc" },
  });
  return NextResponse.json(items);
}

const schema = z.object({
  catalogItemId: z.string().min(1),
  dropiProductId: z.string().trim().min(1, "Falta el ID de Dropi.").max(50),
  dropiPrice: z.number({ error: "Falta el precio que tiene en Dropi." }).positive("Falta el precio que tiene en Dropi."),
});

// El stock de estos productos ya está en el Kardex (se compraron sin
// awaitingDropiId), así que acá solo se guarda el ID — no hay nada que liberar.
export async function POST(req: NextRequest) {
  if (!(await canPublishMarketProduct())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });
  const { catalogItemId, dropiProductId } = parsed.data;

  const item = await prisma.purchaseCatalogItem.findFirst({ where: { id: catalogItemId, ...catalogMissingDropiIdWhere }, select: { id: true } });
  if (!item) return NextResponse.json({ error: "Este producto ya tiene ID o ya no está en la lista." }, { status: 409 });

  const taken = await prisma.purchaseCatalogItem.findUnique({ where: { justCode: dropiProductId }, select: { name: true } });
  if (taken) return NextResponse.json({ error: `El ID ${dropiProductId} ya es de "${taken.name}".` }, { status: 409 });
  const comboClash = await productIdUsedByCombo(dropiProductId);
  if (comboClash) return NextResponse.json({ error: comboClash }, { status: 409 });

  // Ver dropiPriceLossMessage — acá el costo sale del Kardex (se compraron por Compras).
  const basis = (await resolveCostBasisForCatalogItems([catalogItemId])).get(catalogItemId);
  if (basis) {
    const lossMsg = dropiPriceLossMessage(basis, parsed.data.dropiPrice, computeMarketProductSalePrice({ ...basis, marginPercent: DROPI_MARGIN_DEFAULT }));
    if (lossMsg) return NextResponse.json({ error: lossMsg }, { status: 400 });
  }

  const updated = await prisma.purchaseCatalogItem.update({
    where: { id: catalogItemId },
    data: { justCode: dropiProductId },
    select: { id: true, justCode: true },
  });
  return NextResponse.json(updated);
}
