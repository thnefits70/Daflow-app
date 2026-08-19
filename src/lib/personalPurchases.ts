import { prisma } from "@/lib/prisma";

// Confirmado 2026-08-18: rediseño completo — el precio al costo por unidad
// se declara al momento de la compra (hasta 3 unidades por producto). Hijo
// menor de 18: siempre precio al costo, nunca enfriamiento. Cualquier otra
// persona (el mismo colaborador, esposa, otro familiar — sin distinción):
// sujeta a un enfriamiento de 6 meses por (colaborador + producto), usando
// el nombre ya CORREGIDO por Daniel (confirmedProductName) — recién ahí es
// confiable para comparar contra compras anteriores.
const COOLDOWN_MONTHS = 6;
export const MAX_COST_UNITS_PER_ITEM = 3;

export type BuyerRelation = "SELF" | "MINOR_CHILD" | "OTHER_FAMILY";
export type UnitDeclaration = { relation: BuyerRelation; note?: string };
export type PriceMode = "COST" | "DROPI";

function monthsSince(date: Date, now: Date): number {
  return (now.getUTCFullYear() - date.getUTCFullYear()) * 12 + (now.getUTCMonth() - date.getUTCMonth());
}

async function costCooldownEligible(employeeId: string, confirmedProductName: string): Promise<boolean> {
  const lastCostItem = await prisma.personalPurchaseItem.findFirst({
    where: {
      confirmedProductName,
      order: { employeeId },
      unitPriceModes: { array_contains: "COST" },
    },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });
  if (!lastCostItem) return true;
  return monthsSince(lastCostItem.createdAt, new Date()) >= COOLDOWN_MONTHS;
}

// Se calcula UNA SOLA VEZ, al momento en que Daniel confirma el pedido (ya
// con el nombre normalizado) — el resultado queda guardado en
// PersonalPurchaseItem.unitPriceModes, nunca se recalcula después.
export async function computeUnitPriceModes(
  employeeId: string,
  confirmedProductName: string,
  quantity: number,
  declarations: UnitDeclaration[]
): Promise<PriceMode[]> {
  const capped = declarations.slice(0, Math.min(MAX_COST_UNITS_PER_ITEM, quantity));
  const modes: PriceMode[] = [];
  for (const d of capped) {
    if (d.relation === "MINOR_CHILD") {
      modes.push("COST");
      continue;
    }
    const eligible = await costCooldownEligible(employeeId, confirmedProductName);
    modes.push(eligible ? "COST" : "DROPI");
  }
  while (modes.length < quantity) modes.push("DROPI");
  return modes;
}
