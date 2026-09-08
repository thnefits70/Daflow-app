import { prisma } from "@/lib/prisma";

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

function monthsSince(date: Date, now: Date): number {
  return (now.getUTCFullYear() - date.getUTCFullYear()) * 12 + (now.getUTCMonth() - date.getUTCMonth());
}

export type CostCooldownStatus = { eligible: boolean; lastCostAt: Date | null; availableAgainAt: Date | null };

// Confirmado 2026-09-08 (pedido explícito del usuario): Daniel/Nairoby no
// tenían forma de saber POR QUÉ un producto le salía a Dropi a alguien que
// esperaba costo — el cálculo era silencioso. Este status expone la fecha
// de la última compra a costo y cuándo se vuelve a habilitar, para
// mostrarlo como aviso en la pantalla de confirmación de bodega.
export async function getCostCooldownStatus(employeeId: string, confirmedProductName: string, excludeItemId: string | null = null): Promise<CostCooldownStatus> {
  const lastCostItem = await prisma.personalPurchaseItem.findFirst({
    where: {
      confirmedProductName,
      order: { employeeId },
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

async function costCooldownEligible(employeeId: string, confirmedProductName: string, excludeItemId: string | null): Promise<boolean> {
  return (await getCostCooldownStatus(employeeId, confirmedProductName, excludeItemId)).eligible;
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
  confirmedProductName: string,
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
    if (selfEligible === null) selfEligible = await costCooldownEligible(employeeId, confirmedProductName, excludeItemId);
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

export type StalePersonalPurchasePush = { ownerId: string; title: string; body: string; url: string };

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
