// Constantes del rol "Asesor(a) B2B" que también usa el cliente (sin prisma).
// La lógica de asignar/quitar vive en lib/b2bAdvisorRole.ts.

export const B2B_ADVISOR_ROLE_FLAGS = [
  "canPublishMarketProduct", // publicar en Dropi + ID (y catálogo sin ID)
  "canMarkComboCreatedInDropi", // crear en Dropi los combos aprobados
  "canConfirmMarketingAdvisor", // confirmar llegadas como asesora
  "canResolveSupplierStockout", // "Sin stock de proveedor" + dar de baja descontinuados
  "canAssignCancelledGuideItems", // cargar productos de guías canceladas
  "canDeclareExternalSales", // Ventas Externas (clientes B2B)
  "canViewB2BPricing", // Consulta de precios B2B
  "canViewStockLevels", // Stock Actual / INVESTOCK
  "canAddSuppliers", // agregar proveedores
] as const;
export type B2BAdvisorRoleFlag = (typeof B2B_ADVISOR_ROLE_FLAGS)[number];

export const B2B_ADVISOR_FLAG_LABELS: Record<B2BAdvisorRoleFlag, string> = {
  canPublishMarketProduct: "Publicar productos en Dropi y poner el ID de Dropi",
  canMarkComboCreatedInDropi: "Crear en Dropi los combos aprobados",
  canConfirmMarketingAdvisor: "Confirmar llegadas de mercadería como asesor(a)",
  canResolveSupplierStockout: "Resolver \"Sin stock de proveedor\" y dar de baja descontinuados en Dropi",
  canAssignCancelledGuideItems: "Cargar productos de guías canceladas",
  canDeclareExternalSales: "Ventas Externas (clientes B2B)",
  canViewB2BPricing: "Consulta de precios B2B",
  canViewStockLevels: "Ver Stock Actual / INVESTOCK",
  canAddSuppliers: "Agregar proveedores",
};

export const B2B_ADVISOR_TITLES = ["Asesora B2B", "Asesor B2B"] as const;
export const DEFAULT_B2B_ADVISOR_TITLE = "Asesora B2B";

// "la asesora B2B" / "el asesor B2B" para meter dentro de una frase.
export function b2bAdvisorWithArticle(title: string | null | undefined) {
  return title === "Asesor B2B" ? "el asesor B2B" : "la asesora B2B";
}
