import { prisma } from "@/lib/prisma";

// Confirmado 2026-09-02: antes de dejar borrar un producto del catálogo mal
// registrado por Inventario (ver ReviewInbox), se revisa TODO lugar del
// sistema que pueda apuntar a ese id — no solo Reingreso — para no romper
// historial ni dejar una llave foránea huérfana. Si aparece en cualquiera de
// estos, se bloquea el borrado con el nombre de dónde está en uso.
const USAGE_CHECKS: { label: string; count: (id: string) => Promise<number> }[] = [
  { label: "reingresos de mercadería", count: (id) => prisma.merchandiseReentryItem.count({ where: { catalogItemId: id } }) },
  { label: "solicitudes de compra", count: (id) => prisma.purchaseRequest.count({ where: { catalogItemId: id } }) },
  {
    label: "compras personales",
    count: (id) => prisma.personalPurchaseItem.count({ where: { OR: [{ catalogItemId: id }, { confirmedCatalogItemId: id }] } }),
  },
  { label: "salidas de mercadería", count: (id) => prisma.merchandiseOutflowItem.count({ where: { catalogItemId: id } }) },
  { label: "ventas externas", count: (id) => prisma.externalSaleItem.count({ where: { catalogItemId: id } }) },
  { label: "guías canceladas", count: (id) => prisma.cancelledGuideItem.count({ where: { catalogItemId: id } }) },
  { label: "productos de baja rotación", count: (id) => prisma.lowRotationWeeklyEntry.count({ where: { catalogItemId: id } }) },
  {
    label: "sugerencias de combos",
    count: (id) => prisma.comboSuggestion.count({ where: { OR: [{ winnerCatalogItemId: id }, { lowRotationCatalogItemId: id }] } }),
  },
  { label: "combos de Dropi", count: (id) => prisma.dropiComboComponent.count({ where: { catalogItemId: id } }) },
  { label: "estado de sincronización ATOM", count: (id) => prisma.atomProductStatus.count({ where: { matchedCatalogItemId: id } }) },
  { label: "quiebres de stock", count: (id) => prisma.stockoutProduct.count({ where: { catalogItemId: id } }) },
];

// Devuelve el nombre del primer lugar donde el producto todavía está en uso,
// o null si ya no lo referencia nada y se puede borrar de verdad.
export async function findPurchaseCatalogItemUsage(catalogItemId: string): Promise<string | null> {
  for (const check of USAGE_CHECKS) {
    if ((await check.count(catalogItemId)) > 0) return check.label;
  }
  return null;
}
