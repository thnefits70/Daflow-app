import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canViewStockLevels } from "@/lib/guards";
import { getAllCurrentStock } from "@/lib/stockKardex";
import { getFinanzasDeptId } from "@/lib/inventoryKpis";
import {
  bodegaUnitCost,
  computeBenistockPrice,
  computeB2BPrice,
  computeB2CPrice,
  computeMarketProductSalePrice,
  pickPrimarySupplierPrice,
  B2B_MARGIN_DEFAULT,
  DROPI_MARGIN_DEFAULT,
  DROPI_FULFILLMENT_DEFAULT,
} from "@/lib/marketProduct";

// Confirmado 2026-09-10 (pedido explícito del usuario): pantalla "Stock
// actual" — mismo permiso que "Etiquetas de percha" (Daniel, líder de
// Inventario, + admin), para que ambos vean el saldo de INVESTOCK de todos
// los productos en cualquier momento, sin depender de la subida semanal de
// Just.
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

  const deptId = await getFinanzasDeptId();

  // Confirmado 2026-09-16, pedido explícito del usuario: mostrar acá mismo
  // el costo promedio según el último archivo de Just que subió Daniel —
  // por ahora confía más en ese número que en el de INVESTOCK (ver
  // project_stock_comparison_avg_cost) mientras INVESTOCK/devoluciones
  // siguen en prueba. Solo referencia — nunca reemplaza nada, ni se guarda
  // en ningún lado más que en el archivo original de Just.
  const [rows, proposals, justSnapshots, pendingAdjustments] = await Promise.all([
    getAllCurrentStock(),
    prisma.marketProductProposal.findMany({
      where: { catalogItemId: { not: null } },
      include: { supplierPrices: true },
    }),
    deptId
      ? prisma.inventoryProductSnapshot.findMany({
          where: { deptId },
          distinct: ["productCode"],
          orderBy: [{ productCode: "asc" }, { createdAt: "desc" }],
          select: { productCode: true, avgCost: true, stock: true, createdAt: true },
        })
      : Promise.resolve([]),
    // Confirmado 2026-09-22, pedido explícito del usuario: para que la fila
    // muestre "pendiente de aprobación" en vez del botón normal cuando
    // Daniel ya dejó una solicitud de ajuste de stock sin resolver.
    prisma.stockPhysicalCountAdjustmentRequest.findMany({ select: { catalogItemId: true, requestedQuantity: true } }),
  ]);
  const pendingAdjustmentByItem = new Map(pendingAdjustments.map((a) => [a.catalogItemId, a.requestedQuantity]));
  const justAvgCostByCode = new Map(justSnapshots.map((s) => [s.productCode.trim(), s.avgCost]));
  // Confirmado 2026-09-17, pedido explícito del usuario: además del costo,
  // mostrar también el stock tal cual venía en el último archivo de Just
  // subido por Daniel, como columna de referencia junto al stock real de
  // INVESTOCK — para poder comparar los dos números a simple vista.
  const justStockByCode = new Map(justSnapshots.map((s) => [s.productCode.trim(), s.stock]));
  // Confirmado 2026-09-17, pedido explícito del usuario (y follow-up mismo
  // día): ese stock de Just queda "congelado" desde la subida que lo trajo
  // hasta que Daniel suba la siguiente — cada producto puede venir de una
  // subida distinta si dejó de aparecer en archivos más recientes (ver
  // project_just_catalog_sync), así que la fecha/hora exacta (día/mes/año/
  // hora, tal como lo pidió el usuario) se guarda por producto, no una sola
  // para toda la tabla.
  const justStockUploadedAtByCode = new Map(justSnapshots.map((s) => [s.productCode.trim(), s.createdAt.toISOString()]));
  // Fecha/hora del archivo de Just más reciente subido por Daniel en general
  // (el más nuevo entre TODOS los productos) — para mostrar arriba de la
  // tabla como referencia principal, aunque algún producto puntual se haya
  // quedado congelado en una subida más vieja.
  const lastJustUploadAt = justSnapshots.length
    ? justSnapshots.reduce((max, s) => (s.createdAt > max ? s.createdAt : max), justSnapshots[0].createdAt).toISOString()
    : null;

  const proposalByCatalogItemId = new Map(
    proposals
      .filter((p) => p.catalogItemId && pickPrimarySupplierPrice(p.supplierPrices))
      .map((p) => {
        const supplier = pickPrimarySupplierPrice(p.supplierPrices)!;
        return [
          p.catalogItemId!,
          {
            batchCost: supplier.batchCost,
            batchUnits: supplier.batchUnits,
            freightCost: supplier.freightCost,
            insuranceRatePercent: p.insuranceRatePercent,
            fulfillmentCost: p.fulfillmentCost,
            marginPercent: p.marginPercent,
            costSource: "proposal" as const,
          },
        ] as const;
      })
  );

  const withPrices = rows.map((r) => {
    // Confirmado 2026-09-15, pedido explícito del usuario: agrega "Precio
    // proveedor" y "Puesto en bodega" (costo sin y con flete por unidad) y
    // "Precio Dropi" — este último estimado con el mismo criterio de
    // respaldo de Kardex que ya usan Benistock/B2B/B2C para los ~490
    // productos que nunca pasaron por la calculadora de Jariel. Para esos
    // productos no se conoce el flete por separado (freightCost: null), así
    // que "Puesto en bodega" sale igual a "Precio proveedor" — no es un
    // error, es la única base de costo que existe hoy para ellos.
    const justAvgCost = r.justCode ? justAvgCostByCode.get(r.justCode.trim()) ?? null : null;
    const justStock = r.justCode ? justStockByCode.get(r.justCode.trim()) ?? null : null;
    const justStockUploadedAt = r.justCode ? justStockUploadedAtByCode.get(r.justCode.trim()) ?? null : null;
    // Confirmado 2026-09-17, pedido explícito del usuario: si el producto no
    // tiene ni propuesta de Jariel ni costo real de Kardex (INVESTOCK),
    // respaldo TEMPORAL con el costo promedio de Just — mismo criterio que
    // el respaldo de Kardex de arriba — mientras se termina de cargar
    // INVESTOCK para todos los productos. `costSource` marca cuál se usó
    // para que el frontend lo resalte quitándole ambigüedad con un costo
    // real; se quita junto con el respaldo cuando INVESTOCK quede completo.
    const base = proposalByCatalogItemId.get(r.catalogItemId) ??
      (r.avgCost > 0 ? { batchCost: r.avgCost, batchUnits: 1, freightCost: null, insuranceRatePercent: 6, fulfillmentCost: DROPI_FULFILLMENT_DEFAULT, marginPercent: DROPI_MARGIN_DEFAULT, costSource: "kardex" as const } : null) ??
      (justAvgCost && justAvgCost > 0 ? { batchCost: justAvgCost, batchUnits: 1, freightCost: null, insuranceRatePercent: 6, fulfillmentCost: DROPI_FULFILLMENT_DEFAULT, marginPercent: DROPI_MARGIN_DEFAULT, costSource: "just" as const } : null);
    const pendingAdjustmentQuantity = pendingAdjustmentByItem.get(r.catalogItemId) ?? null;
    if (!base) return { ...r, justAvgCost, justStock, justStockUploadedAt, pendingAdjustmentQuantity };
    return {
      ...r,
      justAvgCost,
      justStock,
      justStockUploadedAt,
      pendingAdjustmentQuantity,
      costSource: base.costSource,
      providerPrice: base.batchCost,
      bodegaPrice: bodegaUnitCost(base.batchCost, base.freightCost, base.batchUnits),
      benistockPrice: computeBenistockPrice(base),
      b2bPriceDefault: computeB2BPrice({ ...base, marginPercent: B2B_MARGIN_DEFAULT }),
      dropiPrice: computeMarketProductSalePrice({ ...base, marginPercent: base.marginPercent }),
      b2cPrice1Unit: computeB2CPrice({ ...base, totalQuantity: 1 }),
      b2cPrice2to11: computeB2CPrice({ ...base, totalQuantity: 2 }),
    };
  });

  return NextResponse.json({ rows: withPrices, lastJustUploadAt });
}
