import type { Prisma } from "@/generated/prisma/client";

// Confirmado 2026-09-28, pedido del usuario: productos que entraron por
// Compras → "producto nuevo" ANTES de que ahí se exigiera el ID (22–25 sep,
// Jariel) quedaron sin ID de Dropi y fuera del camino de Análisis de Mercado.
// En vez de que Daniel/admin los completen a mano, le aparecen a Heidy en
// "Publicar en Dropi" y ella pone el ID igual que con cualquier otro.
// Los que esperan su ID por el camino normal (awaitingDropiId) no entran
// acá, y los Suministros tampoco (no se publican en Dropi).
export const catalogMissingDropiIdWhere = {
  justCode: null,
  awaitingDropiId: false,
  pendingRegistration: false,
  OR: [{ bodega: null }, { bodega: { not: "MKT_SUMINISTROS" } }],
} satisfies Prisma.PurchaseCatalogItemWhereInput;
