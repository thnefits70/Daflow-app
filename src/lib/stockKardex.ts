import { prisma } from "@/lib/prisma";

// Fase 3 (INVESTOCK) — confirmado 2026-09-09: el número de stock propio de
// DAFLOW, construido como un Kardex real. Cada movimiento (entrada o
// salida) queda como su propia línea, con el saldo y el costo promedio
// ponderado justo después de esa línea — nunca solo un contador mutable —
// para poder ver exactamente por qué el número es el que es.

export async function getLatestKardexEntry(catalogItemId: string) {
  return prisma.stockKardexEntry.findFirst({
    where: { catalogItemId },
    orderBy: [{ occurredAt: "desc" }, { createdAt: "desc" }],
  });
}

export async function getCurrentStock(catalogItemId: string): Promise<{ balance: number; avgCost: number }> {
  const latest = await getLatestKardexEntry(catalogItemId);
  return { balance: latest?.balanceAfter ?? 0, avgCost: latest?.avgCostAfter ?? 0 };
}

// Confirmado 2026-09-09: costo promedio ponderado — una entrada IN mezcla
// su costo con lo que ya había; una entrada OUT nunca cambia el costo
// promedio (solo reduce el saldo), usa el promedio vigente como costo de
// esa salida específica (para poder valorizarla), congelado en el momento,
// nunca recalculado después.
export async function recordKardexEntry(params: {
  catalogItemId: string;
  type: "IN" | "OUT";
  quantity: number;
  unitCost: number | null;
  occurredAt: Date;
  purchaseRequestReceiptId?: string;
  merchandiseOutflowItemId?: string;
}) {
  const current = await getCurrentStock(params.catalogItemId);

  let balanceAfter: number;
  let avgCostAfter: number;
  let unitCostForRow: number | null;

  if (params.type === "IN") {
    const incomingCost = params.unitCost ?? current.avgCost;
    const newBalance = current.balance + params.quantity;
    // Promedio ponderado: (saldo viejo × costo viejo + entrada × costo entrada) / saldo nuevo.
    // Si el saldo viejo era 0 o negativo (ej. venía de un error), el costo
    // nuevo pasa a ser directo el de esta entrada.
    avgCostAfter =
      newBalance > 0 && current.balance > 0
        ? (current.balance * current.avgCost + params.quantity * incomingCost) / newBalance
        : incomingCost;
    balanceAfter = newBalance;
    unitCostForRow = incomingCost;
  } else {
    balanceAfter = current.balance - params.quantity;
    avgCostAfter = current.avgCost; // una salida nunca cambia el costo promedio
    unitCostForRow = current.avgCost;
  }

  return prisma.stockKardexEntry.create({
    data: {
      catalogItemId: params.catalogItemId,
      type: params.type,
      quantity: params.quantity,
      unitCost: unitCostForRow,
      balanceAfter,
      avgCostAfter,
      occurredAt: params.occurredAt,
      purchaseRequestReceiptId: params.purchaseRequestReceiptId,
      merchandiseOutflowItemId: params.merchandiseOutflowItemId,
    },
  });
}

export type StockAlertProduct = {
  catalogItemId: string;
  name: string;
  balance: number;
};

export type CurrentStockRow = {
  catalogItemId: string;
  name: string;
  justCode: string | null;
  balance: number;
  avgCost: number;
};

// Confirmado 2026-09-10 (pedido explícito del usuario): pantalla "Stock
// actual" — ver de un vistazo el saldo de INVESTOCK de TODOS los productos
// del catálogo, no solo los que ya se movieron. Un producto sin ninguna
// línea de Kardex todavía (nunca entró ni salió por este sistema) aparece
// con saldo 0, no se omite.
export async function getAllCurrentStock(): Promise<CurrentStockRow[]> {
  const [items, latestPerItem] = await Promise.all([
    prisma.purchaseCatalogItem.findMany({ select: { id: true, name: true, justCode: true }, orderBy: { name: "asc" } }),
    prisma.stockKardexEntry.findMany({
      distinct: ["catalogItemId"],
      orderBy: [{ catalogItemId: "asc" }, { occurredAt: "desc" }, { createdAt: "desc" }],
      select: { catalogItemId: true, balanceAfter: true, avgCostAfter: true },
    }),
  ]);
  const byItemId = new Map(latestPerItem.map((e) => [e.catalogItemId, e]));
  return items.map((i) => {
    const latest = byItemId.get(i.id);
    return {
      catalogItemId: i.id,
      name: i.name,
      justCode: i.justCode,
      balance: latest?.balanceAfter ?? 0,
      avgCost: latest?.avgCostAfter ?? 0,
    };
  });
}

// Confirmado 2026-09-09: alerta de stock negativo para la pantalla de KPIs
// financieros → Inventario — misma idea que ya se ve en el export de Just
// (4 SKUs negativos encontrados en el análisis inicial), pero calculada
// desde el Kardex propio en vez de depender de que alguien lo note en Excel.
export async function getNegativeStockProducts(): Promise<StockAlertProduct[]> {
  // Un producto puede tener muchas líneas — se necesita la ÚLTIMA de cada
  // uno. distinct + orderBy hace esto en una sola consulta.
  const latestPerItem = await prisma.stockKardexEntry.findMany({
    distinct: ["catalogItemId"],
    orderBy: [{ catalogItemId: "asc" }, { occurredAt: "desc" }, { createdAt: "desc" }],
    select: { catalogItemId: true, balanceAfter: true, catalogItem: { select: { name: true } } },
  });
  return latestPerItem
    .filter((e) => e.balanceAfter < 0)
    .map((e) => ({ catalogItemId: e.catalogItemId, name: e.catalogItem.name, balance: e.balanceAfter }));
}
