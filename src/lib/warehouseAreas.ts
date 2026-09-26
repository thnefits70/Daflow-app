// Confirmado 2026-09-26 con el usuario: áreas físicas de la bodega, lista
// fija de la A a la G. Daniel/admin asignan cada producto a una desde
// "Stock Actual" (PurchaseCatalogItem.warehouseArea) y el corte de
// Fulfillment agrupa por área dentro de cada bloque de transportadora.
// Archivo sin dependencias de servidor — lo usan rutas y pantallas.
export const WAREHOUSE_AREAS = ["A", "B", "C", "D", "E", "F", "G"] as const;
export type WarehouseArea = (typeof WAREHOUSE_AREAS)[number];

export function isWarehouseArea(v: unknown): v is WarehouseArea {
  return typeof v === "string" && (WAREHOUSE_AREAS as readonly string[]).includes(v);
}

export function areaLabel(area: string | null | undefined): string {
  return area ? `Área ${area}` : "Sin área";
}

// Orden para sacar: A, B, … G y al final lo que no tiene área todavía.
export function areaRank(area: string | null | undefined): number {
  const i = area ? (WAREHOUSE_AREAS as readonly string[]).indexOf(area) : -1;
  return i === -1 ? WAREHOUSE_AREAS.length : i;
}
