import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canViewStockLevels } from "@/lib/guards";
import { getAllCurrentStock } from "@/lib/stockKardex";
import { getUnconfirmedDispatchSummary } from "@/lib/fulfillmentPicking";
import { getVariantStock } from "@/lib/variantStock";
import {
  bodegaUnitCost,
  computeBenistockPrice,
  computeB2BPrice,
  computeB2CPrice,
  computeMarketProductSalePrice,
  resolveCostBasisForCatalogItems,
  B2B_MARGIN_DEFAULT,
  DROPI_MARGIN_DEFAULT,
} from "@/lib/marketProduct";

// Confirmado 2026-09-10 (pedido explícito del usuario): pantalla "Stock
// actual" — mismo permiso que "Etiquetas de percha" (Daniel, líder de
// Inventario, + admin), para que ambos vean el saldo de INVESTOCK de todos
// los productos en cualquier momento.
// Ampliado 2026-09-22, pedido explícito del usuario: Bryan (líder de
// Análisis de Mercado) también ve esta tabla — ver canViewStockLevels en
// guards.ts. Solo lectura: editar la marca sigue siendo exclusivo de
// canManageJustCatalog (Daniel/admin), ver el PATCH de bodega.
// Confirmado 2026-09-15, pedido explícito del usuario: además del costo
// promedio (que ya se veía acá), ahora también trae Benistock/B2B/B2C por
// producto — mismo criterio de prioridad que la consulta de precios de
// Análisis de Mercado (MarketProductProposal de Jariel si existe, si no el
// costo real de Kardex). No es información nueva para quien ve esta
// pantalla: el costo real ya se mostraba acá tal cual, así que no hay nada
// más sensible que antes.
export async function GET() {
  if (!(await canViewStockLevels())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const [rows, pendingAdjustments, unconfirmedDispatch] = await Promise.all([
    getAllCurrentStock(),
    // Confirmado 2026-09-22, pedido explícito del usuario: para que la fila
    // muestre "pendiente de aprobación" en vez del botón normal cuando
    // Daniel ya dejó una solicitud de ajuste de stock sin resolver.
    prisma.stockPhysicalCountAdjustmentRequest.findMany({ select: { catalogItemId: true, requestedQuantity: true } }),
    // Pedido del usuario 2026-10-01: avisar que el stock todavía no descuenta
    // los cortes que Daniel no ha confirmado.
    getUnconfirmedDispatchSummary(),
  ]);
  const pendingAdjustmentByItem = new Map(pendingAdjustments.map((a) => [a.catalogItemId, a.requestedQuantity]));
  // Cambiado 2026-09-30, pedido del usuario: el costo para los precios sale
  // de lo que queda de verdad en bodega (ver sellingCost.ts), no del
  // promedio del Kardex ni del costo fijo de la propuesta de Jariel.
  const [costBasisByItemId, variantStock] = await Promise.all([
    resolveCostBasisForCatalogItems(rows.map((r) => r.catalogItemId)),
    // Stock por variante (2026-10-06): desglose por color/talla.
    getVariantStock(rows.map((r) => r.catalogItemId)),
  ]);

  const withPrices = rows.map((r) => {
    const variants = variantStock.get(r.catalogItemId) ?? null;
    return withPrice({ ...r, variantStock: variants });
  });

  function withPrice<T extends (typeof rows)[number]>(r: T) {
    // Confirmado 2026-09-15, pedido explícito del usuario: agrega "Precio
    // proveedor" y "Puesto en bodega" (costo sin y con flete por unidad) y
    // "Precio Dropi" — este último estimado con el mismo criterio de
    // respaldo de Kardex que ya usan Benistock/B2B/B2C para los ~490
    // productos que nunca pasaron por la calculadora de Jariel.
    // 2026-10-02: el flete de cada compra ya se separa (sellingCost.ts), así
    // que "Precio proveedor" sale sin flete y "Puesto en bodega" con flete.
    const base = costBasisByItemId.get(r.catalogItemId) ?? null;
    const pendingAdjustmentQuantity = pendingAdjustmentByItem.get(r.catalogItemId) ?? null;
    if (!base) return { ...r, pendingAdjustmentQuantity };
    return {
      ...r,
      pendingAdjustmentQuantity,
      costSource: base.costSource,
      providerPrice: base.batchCost,
      bodegaPrice: bodegaUnitCost(base.batchCost, base.freightCost, base.batchUnits),
      benistockPrice: computeBenistockPrice(base),
      b2bPriceDefault: computeB2BPrice({ ...base, marginPercent: B2B_MARGIN_DEFAULT }),
      dropiPrice: computeMarketProductSalePrice({ ...base, marginPercent: base.marginPercent ?? DROPI_MARGIN_DEFAULT }),
      b2cPrice1Unit: computeB2CPrice({ ...base, totalQuantity: 1 }),
      b2cPrice2to11: computeB2CPrice({ ...base, totalQuantity: 2 }),
    };
  }

  return NextResponse.json({ rows: withPrices, unconfirmedDispatch });
}
