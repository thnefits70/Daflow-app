import { prisma } from "@/lib/prisma";
import { getCurrentStockByItemIds } from "@/lib/stockKardex";
import { NOT_SUPPLY } from "@/lib/newIdBranding";
import { resolveCostBasisForCatalogItems, computeMarketProductSalePrice, DROPI_MARGIN_DEFAULT } from "@/lib/marketProduct";

// Confirmado 2026-08-08: "Mercadería recibida" — pedido explícito del
// usuario para que Análisis de Mercado (MKT) sepa apenas Daniel confirma
// algo como recibido, y cada quien haga su parte (Robert diseña, Heidy o
// Jariel asesoran) sin tener que abrir Control de Compras.
export const MKT_DEPT_CODE = "MKT";

const arrivalInclude = {
  catalogItem: { select: { name: true, photos: true, justCode: true } },
  receipt: { select: { id: true, photoUrls: true, receivedQuantity: true, confirmedAt: true } },
  marketingFollowUp: {
    include: {
      designConfirmedBy: { select: { name: true } },
      advisorConfirmedBy: { select: { name: true, marketingAdvisorBrand: true } },
    },
  },
};

// Confirmado 2026-09-16, pedido explícito del usuario: antes solo mostraba
// RECEIVED (aprobado por Daniel). Ahora incluye también
// RECEIVED_PENDING_REVIEW — Robert/Heidy/Jariel/Yair ven la llegada y pueden
// confirmar su parte apenas bodega registra la recepción, sin esperar la
// aprobación de Daniel (que ya solo importa para Compras/Kardex).
// Confirmado 2026-09-29, pedido del usuario: si el asesor ya confirmó una
// llegada anterior del mismo producto, la tarjeta se acorta a "solo sube el
// stock en Dropi" (la descripción y la publicación no cambian). Se sigue
// pidiendo cada llegada porque Dropi no está conectado y el stock allá se
// sube a mano. Si esta compra salió más cara por unidad (proveedor + flete)
// que la última confirmada, avisa que revise el precio en Dropi.
function landedUnitCost(r: { unitCost: number; quantity: number; shippingIncluded: boolean; shippingCostTotal: number | null }) {
  const freight = !r.shippingIncluded && r.shippingCostTotal && r.quantity > 0 ? r.shippingCostTotal / r.quantity : 0;
  return r.unitCost + freight;
}

export async function getMarketingArrivals() {
  const rows = await prisma.purchaseRequest.findMany({
    // Los Suministros no se venden ni van a Dropi (ver NOT_SUPPLY).
    where: { status: { in: ["RECEIVED_PENDING_REVIEW", "RECEIVED"] }, catalogItem: NOT_SUPPLY },
    orderBy: { receipt: { confirmedAt: "desc" } },
    include: arrivalInclude,
  });
  // Pedido del usuario 2026-09-30: el aviso muestra el Precio Dropi (el
  // mismo de Stock Actual) para copiarlo, no el costo del proveedor.
  const bases = await resolveCostBasisForCatalogItems(rows.map((r) => r.catalogItemId));
  // Pedido del usuario 2026-09-30: la tarjeta le dice a Heidy cuánto stock
  // hay en bodega AHORA (con lo que acaba de llegar ya sumado), para que no
  // haga la cuenta a mano. Lo recibido entra al Kardex recién cuando Daniel
  // aprueba la recepción; si todavía no entró, se suma aparte.
  const itemIds = [...new Set(rows.map((r) => r.catalogItemId))];
  const receiptIds = rows.map((r) => r.receipt?.id).filter((id): id is string => !!id);
  const [stockNow, inKardex] = await Promise.all([
    getCurrentStockByItemIds(itemIds),
    receiptIds.length
      ? prisma.stockKardexEntry.findMany({ where: { purchaseRequestReceiptId: { in: receiptIds } }, select: { purchaseRequestReceiptId: true } })
      : Promise.resolve([]),
  ]);
  const receiptsInKardex = new Set(inKardex.map((e) => e.purchaseRequestReceiptId));
  // Lo que ya llegó a bodega pero todavía no pasó al Kardex, por producto.
  const pendingByItem = new Map<string, number>();
  for (const r of rows) {
    if (r.receipt && !receiptsInKardex.has(r.receipt.id)) {
      pendingByItem.set(r.catalogItemId, (pendingByItem.get(r.catalogItemId) ?? 0) + r.receipt.receivedQuantity);
    }
  }
  return rows.map((r) => {
    const basis = bases.get(r.catalogItemId);
    const dropiPriceNow = basis ? Math.round(computeMarketProductSalePrice({ ...basis, marginPercent: basis.marginPercent ?? DROPI_MARGIN_DEFAULT }) * 100) / 100 : null;
    const arrivedAt = r.receipt?.confirmedAt?.getTime() ?? 0;
    const previous = rows
      .filter((o) => o.id !== r.id && o.catalogItemId === r.catalogItemId && o.marketingFollowUp?.advisorConfirmedAt && (o.receipt?.confirmedAt?.getTime() ?? 0) < arrivedAt)
      .sort((a, b) => (b.receipt?.confirmedAt?.getTime() ?? 0) - (a.receipt?.confirmedAt?.getTime() ?? 0))[0];
    const costNow = landedUnitCost(r);
    const costBefore = previous ? landedUnitCost(previous) : null;
    return {
      ...r,
      repeatArrival: previous
        ? {
            lastConfirmedAt: previous.marketingFollowUp!.advisorConfirmedAt!,
            costIncreased: costBefore !== null && costNow - costBefore >= 0.01,
            costBefore: Math.round((costBefore ?? 0) * 100) / 100,
            costNow: Math.round(costNow * 100) / 100,
            dropiPriceNow,
            stockInWarehouse: Math.max(0, (stockNow.get(r.catalogItemId)?.balance ?? 0) + (pendingByItem.get(r.catalogItemId) ?? 0)),
          }
        : null,
    };
  });
}

// Confirmado 2026-08-18: lista de quién puede confirmar cada rol, para que
// el panel arme filtros por persona ("lo que Jariel todavía no confirma") y
// pueda priorizar lo más antiguo primero sin tener que adivinar nombres.
export async function getMarketingArrivalConfirmers(): Promise<{ id: string; name: string; role: "design" | "advisor" }[]> {
  const users = await prisma.user.findMany({
    where: { isActive: true, OR: [{ canConfirmMarketingDesign: true }, { canConfirmMarketingAdvisor: true }] },
    select: { id: true, name: true, canConfirmMarketingDesign: true, canConfirmMarketingAdvisor: true },
  });
  const confirmers: { id: string; name: string; role: "design" | "advisor" }[] = [];
  for (const u of users) {
    if (u.canConfirmMarketingDesign) confirmers.push({ id: u.id, name: u.name, role: "design" });
    if (u.canConfirmMarketingAdvisor) confirmers.push({ id: u.id, name: u.name, role: "advisor" });
  }
  return confirmers;
}

// Confirmado 2026-08-08: se le avisa a TODOS los que puedan confirmar ese
// rol (Robert es el único diseñador hoy, pero puede haber más de un
// asesor — Heidy Y Jariel se enteran de toda llegada, aunque en la
// práctica solo a uno de los dos le corresponda de verdad).
export async function getMarketingArrivalActorIds(role: "design" | "advisor"): Promise<string[]> {
  const flag = role === "design" ? { canConfirmMarketingDesign: true } : { canConfirmMarketingAdvisor: true };
  const users = await prisma.user.findMany({ where: { ...flag, isActive: true }, select: { id: true } });
  return users.map((u) => u.id);
}

// Confirmado 2026-08-28: quién debe enterarse por push de cada llegada para
// ir organizando el despacho (hoy Yair), sin poder confirmar diseño ni
// asesor — ver canViewMarketingArrivalsForDispatch en guards.ts.
export async function getMarketingArrivalDispatchViewerIds(): Promise<string[]> {
  const users = await prisma.user.findMany({ where: { canViewMarketingArrivalsForDispatch: true, isActive: true }, select: { id: true } });
  return users.map((u) => u.id);
}
