import { prisma } from "@/lib/prisma";
import { bodegaUnitCost, computeMarketProductSalePrice, resolveCostBasisForCatalogItems, resolveDropiParamsForCatalogItems, DROPI_MARGIN_DEFAULT } from "@/lib/marketProduct";
import { addBusinessDays } from "@/lib/businessHours";

// Confirmado 2026-08-18: rediseño completo — el precio al costo por unidad
// se declara al momento de la compra (hasta 3 unidades por producto). Hijo
// menor de 18: siempre precio al costo, nunca enfriamiento.
//
// Confirmado 2026-09-08 (pedido explícito del usuario): se endureció la
// regla para todos los demás casos.
// - Producto combo (su justCode ya está registrado como código de combo en
//   DropiCombo — ver ese modelo: esos IDs se registran a mano en DAFLOW,
//   nunca vienen del archivo de Just): SIEMPRE precio Dropi, sin
//   excepción, ni para hijo/a menor.
// - "Otra persona" (fuera de uno mismo o hijo/a menor): SIEMPRE precio
//   Dropi, ya no hay chance de costo.
// - Uno mismo (SELF): precio al costo solo para 1 unidad — si pide más de
//   una del mismo producto, la unidad extra ya se cobra a Dropi — y solo
//   si no volvió a comprar ese mismo producto en los últimos 6 meses
//   (enfriamiento por colaborador + producto, usando el nombre ya
//   CORREGIDO por Daniel — confirmedProductName — recién ahí es confiable
//   para comparar contra compras anteriores).
const COOLDOWN_MONTHS = 6;
export const MAX_COST_UNITS_PER_ITEM = 3;
const MAX_SELF_COST_UNITS_PER_ITEM = 1;

export type BuyerRelation = "SELF" | "MINOR_CHILD" | "OTHER_FAMILY";
export type UnitDeclaration = { relation: BuyerRelation; note?: string };
export type PriceMode = "COST" | "DROPI";

// Confirmado 2026-09-08 (pedido explícito del usuario): antes Nairoby
// definía las cuotas al cerrar el precio, sin tope. Ahora las elige el
// colaborador recién al escoger "Descuento en rol" — con un total de $10 o
// menos no hay opción (1 sola cuota, no vale la pena partirlo), con más de
// $10 puede elegir hasta MAX_INSTALLMENTS, sin importar qué tan grande sea
// el total (una compra de $60 sigue topando en 3 cuotas).
export const MAX_INSTALLMENTS = 3;
const SMALL_PURCHASE_INSTALLMENT_THRESHOLD = 10;

export function maxInstallmentsForAmount(totalAmount: number): number {
  return totalAmount > SMALL_PURCHASE_INSTALLMENT_THRESHOLD ? MAX_INSTALLMENTS : 1;
}

function monthsSince(date: Date, now: Date): number {
  return (now.getUTCFullYear() - date.getUTCFullYear()) * 12 + (now.getUTCMonth() - date.getUTCMonth());
}

export type CostCooldownStatus = { eligible: boolean; lastCostAt: Date | null; availableAgainAt: Date | null };

// Confirmado 2026-09-08 (pedido explícito del usuario): Daniel/Nairoby no
// tenían forma de saber POR QUÉ un producto le salía a Dropi a alguien que
// esperaba costo — el cálculo era silencioso. Este status expone la fecha
// de la última compra a costo y cuándo se vuelve a habilitar, para
// mostrarlo como aviso en la pantalla de confirmación de bodega.
//
// Confirmado 2026-10-02 (pedido explícito del usuario): el producto se
// reconoce por su ID del catálogo, no solo por el nombre — un nombre
// escrito distinto ya no cuenta como "otro producto". El nombre queda como
// respaldo para compras viejas sin ID. Pedidos rechazados no cuentan.
export type CooldownProduct = { catalogItemId: string | null; name: string };

export async function getCostCooldownStatus(employeeId: string, product: CooldownProduct, excludeItemId: string | null = null): Promise<CostCooldownStatus> {
  const lastCostItem = await prisma.personalPurchaseItem.findFirst({
    where: {
      OR: [
        ...(product.catalogItemId ? [{ confirmedCatalogItemId: product.catalogItemId }] : []),
        { confirmedProductName: product.name },
      ],
      order: { employeeId, status: { not: "REJECTED" } },
      unitPriceModes: { array_contains: "COST" },
      ...(excludeItemId ? { id: { not: excludeItemId } } : {}),
    },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });
  if (!lastCostItem) return { eligible: true, lastCostAt: null, availableAgainAt: null };
  const eligible = monthsSince(lastCostItem.createdAt, new Date()) >= COOLDOWN_MONTHS;
  const availableAgainAt = new Date(lastCostItem.createdAt);
  availableAgainAt.setUTCMonth(availableAgainAt.getUTCMonth() + COOLDOWN_MONTHS);
  return { eligible, lastCostAt: lastCostItem.createdAt, availableAgainAt };
}

async function costCooldownEligible(employeeId: string, product: CooldownProduct, excludeItemId: string | null): Promise<boolean> {
  return (await getCostCooldownStatus(employeeId, product, excludeItemId)).eligible;
}

async function isComboJustCode(justCode: string | null): Promise<boolean> {
  if (!justCode) return false;
  const combo = await prisma.dropiCombo.findUnique({ where: { code: justCode }, select: { id: true } });
  return !!combo;
}

// Se calcula UNA SOLA VEZ, al momento en que Daniel confirma el pedido (ya
// con el nombre normalizado) — el resultado queda guardado en
// PersonalPurchaseItem.unitPriceModes, nunca se recalcula después.
export async function computeUnitPriceModes(
  employeeId: string,
  product: CooldownProduct,
  quantity: number,
  declarations: UnitDeclaration[],
  confirmedJustCode: string | null,
  excludeItemId: string | null = null
): Promise<PriceMode[]> {
  if (await isComboJustCode(confirmedJustCode)) {
    return Array.from({ length: quantity }, () => "DROPI" as PriceMode);
  }

  const capped = declarations.slice(0, Math.min(MAX_COST_UNITS_PER_ITEM, quantity));
  const modes: PriceMode[] = [];
  let selfCostUnitsGranted = 0;
  let selfEligible: boolean | null = null;
  for (const d of capped) {
    if (d.relation === "MINOR_CHILD") {
      modes.push("COST");
      continue;
    }
    if (d.relation === "OTHER_FAMILY") {
      modes.push("DROPI");
      continue;
    }
    // SELF
    if (selfCostUnitsGranted >= MAX_SELF_COST_UNITS_PER_ITEM) {
      modes.push("DROPI");
      continue;
    }
    if (selfEligible === null) selfEligible = await costCooldownEligible(employeeId, product, excludeItemId);
    if (selfEligible) {
      modes.push("COST");
      selfCostUnitsGranted++;
    } else {
      modes.push("DROPI");
    }
  }
  while (modes.length < quantity) modes.push("DROPI");
  return modes;
}

export type AutoUnitPricing = { costUnitPrice: number; dropiUnitPrice: number };

// Confirmado 2026-09-21, pedido explícito del usuario: precio automático al
// confirmar bodega — ya NO lo escribe Nairoby a mano. Mismo criterio de
// costo (y mismas fórmulas) que ya usa "Stock Actual" para "Puesto en
// bodega"/"Precio Dropi" — en orden de prioridad: (1) propuesta de Jariel en
// Análisis de Mercado, (2) costo promedio real de Kardex/INVESTOCK.
// Productos combo se calculan IGUAL que un producto individual
// (pedido explícito del usuario) — no se les da un tratamiento aparte. Si un
// producto no tiene ninguna de las 2 fuentes, queda AUSENTE del mapa — el
// llamador nunca debe inventar un valor, el pedido se queda esperando.
// Corregido 2026-10-02, pedido del usuario: compras personales se había
// quedado con el promedio del Kardex / costo fijo de la propuesta cuando el
// 2026-09-30 Stock Actual pasó a calcular el costo según lo que QUEDA en
// bodega (sellingCost.ts). Ahora usa exactamente la misma base
// (resolveCostBasisForCatalogItems), así "Puesto en bodega" y "Precio
// Dropi" salen iguales que en Stock Actual.
export async function resolveAutoUnitPricing(catalogItemIds: string[]): Promise<Map<string, AutoUnitPricing>> {
  const basisById = await resolveCostBasisForCatalogItems(catalogItemIds);
  const result = new Map<string, AutoUnitPricing>();
  for (const [id, basis] of basisById) {
    if (!(basis.batchCost > 0)) continue;
    result.set(id, {
      costUnitPrice: bodegaUnitCost(basis.batchCost, basis.freightCost, basis.batchUnits),
      dropiUnitPrice: computeMarketProductSalePrice({ ...basis, marginPercent: basis.marginPercent ?? DROPI_MARGIN_DEFAULT }),
    });
  }
  return result;
}

export type AutoPriceAttemptResult = { priced: true; totalAmount: number; employeeId: string } | { priced: false };

// Confirmado 2026-09-21, pedido explícito del usuario: intenta cerrar el
// precio de una orden que está en PENDING_FINANCE usando el costo
// automático de INVESTOCK (resolveAutoUnitPricing). La usan dos lugares:
// confirm-inventory (apenas Daniel confirma bodega, el caso normal) y
// retry-auto-price (botón de admin para reintentar pedidos que se quedaron
// esperando costo). Si TODOS los productos ya tienen costo, cierra el
// precio y la orden pasa a "elegir cómo pagar"; si a alguno le sigue
// faltando, no toca nada y devuelve priced:false — nunca cierra a medias.
export async function attemptAutoPriceOrder(orderId: string): Promise<AutoPriceAttemptResult> {
  const order = await prisma.personalPurchaseOrder.findUnique({
    where: { id: orderId },
    select: { status: true, employeeId: true, items: { select: { id: true, confirmedCatalogItemId: true, unitPriceModes: true } } },
  });
  if (!order || order.status !== "PENDING_FINANCE") return { priced: false };
  if (order.items.some((it) => !it.confirmedCatalogItemId)) return { priced: false };

  const catalogItemIds = order.items.map((it) => it.confirmedCatalogItemId!);
  const autoPricing = await resolveAutoUnitPricing(catalogItemIds);
  const allPriced = order.items.every((it) => autoPricing.has(it.confirmedCatalogItemId!));
  if (!allPriced) return { priced: false };

  let totalAmount = 0;
  for (const it of order.items) {
    const pricing = autoPricing.get(it.confirmedCatalogItemId!)!;
    const modes = (Array.isArray(it.unitPriceModes) ? it.unitPriceModes : []) as PriceMode[];
    const costCount = modes.filter((m) => m === "COST").length;
    const dropiCount = modes.filter((m) => m === "DROPI").length;
    const itemTotal = costCount * pricing.costUnitPrice + dropiCount * pricing.dropiUnitPrice;
    totalAmount += itemTotal;
    await prisma.personalPurchaseItem.update({ where: { id: it.id }, data: { costUnitPrice: pricing.costUnitPrice, dropiUnitPrice: pricing.dropiUnitPrice, itemTotal } });
  }

  await prisma.personalPurchaseOrder.update({
    where: { id: orderId },
    data: { status: "PENDING_PAYMENT_METHOD", totalAmount, transferDeadlineAt: addBusinessDays(new Date(), 3), financeConfirmedAt: new Date() },
  });

  return { priced: true, totalAmount, employeeId: order.employeeId };
}

export type UnitPriceExplanation = { mode: PriceMode; who: string; reason: string };
export type DropiPriceSteps = { bodega: number; insuranceRatePercent: number; withInsurance: number; fulfillmentCost: number; withFulfillment: number; marginPercent: number; dropi: number };
export type ItemPriceExplanation = { units: UnitPriceExplanation[]; dropiSteps: DropiPriceSteps | null };

type ExplainItemInput = {
  id: string;
  employeeId: string;
  createdAt: Date;
  quantity: number;
  confirmedProductName: string | null;
  confirmedCatalogItemId: string | null;
  confirmedJustCode: string | null;
  unitDeclarations: unknown;
  unitPriceModes: unknown;
  costUnitPrice: number | null;
  dropiUnitPrice: number | null;
};

const RELATION_LABEL: Record<BuyerRelation, string> = { SELF: "Para él/ella", MINOR_CHILD: "Hijo/a menor", OTHER_FAMILY: "Otra persona" };

function shortDate(d: Date): string {
  return d.toLocaleDateString("es-EC", { timeZone: "America/Guayaquil", day: "2-digit", month: "short", year: "numeric" });
}

// Pedido del usuario 2026-10-03 (caso Joel, cinturón $5.39): admin/Nairoby
// no veían POR QUÉ una compra salió a ese precio. Explica, con lo que YA
// quedó guardado (unitPriceModes, costo y Dropi por unidad), por qué cada
// unidad fue costo o Dropi, y cómo se armó el Precio Dropi. No recalcula ni
// cambia nada. El desglose del Dropi solo se muestra si los parámetros
// actuales del producto reproducen el precio guardado (pedidos viejos con
// precio escrito a mano no cuadran → solo se muestran los montos).
export async function explainPersonalPurchaseItems(items: ExplainItemInput[]): Promise<Map<string, ItemPriceExplanation>> {
  const result = new Map<string, ItemPriceExplanation>();
  const catalogIds = items.map((it) => it.confirmedCatalogItemId).filter((x): x is string => !!x);
  const justCodes = items.map((it) => it.confirmedJustCode).filter((x): x is string => !!x);
  const [paramsById, combos] = await Promise.all([
    resolveDropiParamsForCatalogItems(catalogIds),
    justCodes.length ? prisma.dropiCombo.findMany({ where: { code: { in: justCodes } }, select: { code: true } }) : Promise.resolve([]),
  ]);
  const comboCodes = new Set(combos.map((c) => c.code));

  for (const it of items) {
    const modes = (Array.isArray(it.unitPriceModes) ? it.unitPriceModes : []) as PriceMode[];
    const decls = (Array.isArray(it.unitDeclarations) ? it.unitDeclarations : []) as UnitDeclaration[];
    const isCombo = !!it.confirmedJustCode && comboCodes.has(it.confirmedJustCode);
    const units: UnitPriceExplanation[] = [];
    let selfCostSeen = false;
    for (let i = 0; i < modes.length; i++) {
      const mode = modes[i];
      const d = decls[i];
      const who = d ? `${RELATION_LABEL[d.relation]}${d.note ? ` (${d.note})` : ""}` : "Sin declarar";
      let reason: string;
      if (isCombo && mode === "DROPI") reason = "Es un combo: siempre va a precio Dropi.";
      else if (!d || i >= MAX_COST_UNITS_PER_ITEM) reason = `Pasa del tope de ${MAX_COST_UNITS_PER_ITEM} unidades que pueden ir al costo.`;
      else if (d.relation === "MINOR_CHILD") reason = mode === "COST" ? "Hijo/a menor de 18: siempre al costo." : "Precio Dropi.";
      else if (d.relation === "OTHER_FAMILY") reason = "Para otra persona: siempre precio Dropi. El costo es solo para uno mismo o un hijo/a menor.";
      else if (mode === "COST") {
        reason = "Para uno mismo: 1 unidad al costo por producto cada 6 meses.";
        selfCostSeen = true;
      } else if (selfCostSeen) reason = "Solo 1 unidad propia por producto va al costo; esta es una adicional.";
      else {
        const prev = await prisma.personalPurchaseItem.findFirst({
          where: {
            id: { not: it.id },
            createdAt: { lt: it.createdAt },
            OR: [
              ...(it.confirmedCatalogItemId ? [{ confirmedCatalogItemId: it.confirmedCatalogItemId }] : []),
              ...(it.confirmedProductName ? [{ confirmedProductName: it.confirmedProductName }] : []),
            ],
            order: { employeeId: it.employeeId, status: { not: "REJECTED" } },
            unitPriceModes: { array_contains: "COST" },
          },
          orderBy: { createdAt: "desc" },
          select: { createdAt: true },
        });
        if (prev) {
          const again = new Date(prev.createdAt);
          again.setUTCMonth(again.getUTCMonth() + COOLDOWN_MONTHS);
          reason = `Ya compró este producto al costo el ${shortDate(prev.createdAt)}; vuelve a poder al costo desde el ${shortDate(again)}.`;
        } else reason = "Para uno mismo, pero no calificó al costo cuando se confirmó.";
      }
      units.push({ mode, who, reason });
    }

    let dropiSteps: DropiPriceSteps | null = null;
    const params = it.confirmedCatalogItemId ? paramsById.get(it.confirmedCatalogItemId) : undefined;
    if (params && it.costUnitPrice && it.dropiUnitPrice && modes.includes("DROPI")) {
      const withInsurance = it.costUnitPrice * (1 + params.insuranceRatePercent / 100);
      const withFulfillment = withInsurance + params.fulfillmentCost;
      const dropi = withFulfillment / (1 - params.marginPercent / 100);
      if (Math.abs(dropi - it.dropiUnitPrice) < 0.01) {
        dropiSteps = { bodega: it.costUnitPrice, insuranceRatePercent: params.insuranceRatePercent, withInsurance, fulfillmentCost: params.fulfillmentCost, withFulfillment, marginPercent: params.marginPercent, dropi };
      }
    }
    result.set(it.id, { units, dropiSteps });
  }
  return result;
}

export type StalePersonalPurchasePush ={ ownerId: string; title: string; body: string; url: string };

// Confirmado 2026-08-20: recordatorio diario del cron de pendientes
// (push-pendientes). Días 1-3 hábiles desde que Nairoby cerró el precio
// (transferDeadlineAt todavía no vencido): recordatorio al colaborador con
// el monto pendiente. Vencido el plazo: se apaga el aviso al colaborador y
// empieza el aviso a Nairoby/FIN + admin, hasta que suba el comprobante —
// cada pedido corre por separado, sin combinar plazos entre sí.
export async function getStalePersonalPurchaseTransferPushes(): Promise<StalePersonalPurchasePush[]> {
  const now = new Date();
  const pushes: StalePersonalPurchasePush[] = [];

  const stillDeciding = await prisma.personalPurchaseOrder.findMany({
    where: { status: { in: ["PENDING_PAYMENT_METHOD", "PENDING_TRANSFER_PROOF"] }, transferDeadlineAt: { gt: now } },
    select: { employeeId: true, totalAmount: true },
  });
  for (const o of stillDeciding) {
    pushes.push({
      ownerId: o.employeeId,
      title: "💵 Tenés un pago pendiente",
      body: `Compra personal — $${o.totalAmount?.toFixed(2)} por pagar.`,
      url: "/area/compras-personales",
    });
  }

  const overdue = await prisma.personalPurchaseOrder.findMany({
    where: { status: { in: ["PENDING_PAYMENT_METHOD", "PENDING_TRANSFER_PROOF"] }, transferDeadlineAt: { lte: now } },
    include: { employee: { select: { name: true } } },
  });
  if (overdue.length > 0) {
    const finLeader = await prisma.user.findFirst({ where: { isLeader: true, leadsDept: { code: "FIN" } }, select: { id: true } });
    for (const o of overdue) {
      const body = `${o.employee.name} no pagó su compra personal — $${o.totalAmount?.toFixed(2)}.`;
      pushes.push({ ownerId: "admin", title: "⏰ Pago de compra personal vencido", body, url: "/area/compras-personales" });
      if (finLeader) {
        pushes.push({ ownerId: finLeader.id, title: "⏰ Pago de compra personal vencido", body, url: "/area/nomina?tab=pagos&ptab=comprasfinanzas" });
      }
    }
  }

  return pushes;
}
