import { prisma } from "@/lib/prisma";

// Confirmado 2026-08-18: pedido explícito del usuario — precio al costo
// solo para el propio colaborador o sus hijos menores de 18 (declarado, sin
// registro formal de familiares), y solo si pasaron 6 meses o más desde la
// última vez que compró ESTE MISMO producto a precio al costo. Otro
// familiar adulto siempre paga precio Dropi vigente, sin excepción, sin
// importar el enfriamiento.
//
// Ajustado el mismo día: esto solo declara el MODO de precio (costo o
// Dropi) — nunca un monto en dólares. El catálogo no guarda precio; el
// valor real lo digita Nairoby recién al cerrar la compra (confirm-finance).
const COOLDOWN_MONTHS = 6;

export const COST_PRICE_RULE_TEXT =
  "Precio al costo: solo aplica para vos o para tus hijos menores de 18 años, y solo si pasaron 6 meses o más desde tu última compra de este mismo producto a precio al costo.";

function monthsSince(date: Date, now: Date): number {
  return (now.getUTCFullYear() - date.getUTCFullYear()) * 12 + (now.getUTCMonth() - date.getUTCMonth());
}

export async function computePriceMode(
  employeeId: string,
  productId: string,
  buyerRelation: "SELF" | "MINOR_CHILD" | "OTHER_FAMILY"
): Promise<{ priceMode: "COST" | "DROPI"; cooldownNote: string | null }> {
  const product = await prisma.retailProduct.findUnique({ where: { id: productId } });
  if (!product) throw new Error("Producto no encontrado.");

  if (buyerRelation === "OTHER_FAMILY") {
    return { priceMode: "DROPI", cooldownNote: null };
  }

  const lastCostPurchase = await prisma.personalPurchase.findFirst({
    where: { employeeId, productId, priceMode: "COST", status: { in: ["PENDING_INVENTORY", "PENDING_FINANCE", "APPROVED"] } },
    orderBy: { createdAt: "desc" },
  });

  if (!lastCostPurchase) return { priceMode: "COST", cooldownNote: null };

  const elapsed = monthsSince(lastCostPurchase.createdAt, new Date());
  if (elapsed >= COOLDOWN_MONTHS) return { priceMode: "COST", cooldownNote: null };

  return {
    priceMode: "DROPI",
    cooldownNote: `Ya compraste este producto a precio al costo hace ${elapsed} mes${elapsed === 1 ? "" : "es"} — hay que esperar ${COOLDOWN_MONTHS} meses entre compras a precio al costo del mismo producto, así que esta vez aplica el precio de Dropi.`,
  };
}
