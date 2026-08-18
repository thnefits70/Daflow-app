import { prisma } from "@/lib/prisma";

// Confirmado 2026-08-18: pedido explícito del usuario — precio al costo
// solo para el propio colaborador o sus hijos menores de 18 (declarado, sin
// registro formal de familiares), y solo si pasaron 6 meses o más desde la
// última vez que compró ESTE MISMO producto a precio al costo. Otro
// familiar adulto siempre paga precio Dropi vigente, sin excepción, sin
// importar el enfriamiento.
const COOLDOWN_MONTHS = 6;

function monthsSince(date: Date, now: Date): number {
  return (now.getUTCFullYear() - date.getUTCFullYear()) * 12 + (now.getUTCMonth() - date.getUTCMonth());
}

export async function computePurchasePrice(
  employeeId: string,
  productId: string,
  buyerRelation: "SELF" | "MINOR_CHILD" | "OTHER_FAMILY"
): Promise<{ priceMode: "COST" | "DROPI"; unitPrice: number; cooldownNote: string | null }> {
  const product = await prisma.retailProduct.findUnique({ where: { id: productId } });
  if (!product) throw new Error("Producto no encontrado.");

  if (buyerRelation === "OTHER_FAMILY") {
    return { priceMode: "DROPI", unitPrice: product.dropiPrice, cooldownNote: null };
  }

  const lastCostPurchase = await prisma.personalPurchase.findFirst({
    where: { employeeId, productId, priceMode: "COST", status: { in: ["PENDING_INVENTORY", "PENDING_FINANCE", "APPROVED"] } },
    orderBy: { createdAt: "desc" },
  });

  if (!lastCostPurchase) {
    return { priceMode: "COST", unitPrice: product.costPrice, cooldownNote: null };
  }

  const elapsed = monthsSince(lastCostPurchase.createdAt, new Date());
  if (elapsed >= COOLDOWN_MONTHS) {
    return { priceMode: "COST", unitPrice: product.costPrice, cooldownNote: null };
  }

  return {
    priceMode: "DROPI",
    unitPrice: product.dropiPrice,
    cooldownNote: `Ya compraste este producto a precio al costo hace ${elapsed} mes${elapsed === 1 ? "" : "es"} — hay que esperar ${COOLDOWN_MONTHS} meses entre compras a precio al costo del mismo producto, así que esta vez aplica el precio de Dropi.`,
  };
}
