// Regla única de qué pestañas de "Mi área de trabajo" ve cada persona —
// la usan DeptWorkspaceTabs.tsx (lo que se dibuja) y maryHelp.ts (lo único
// que Mary puede explicar cuando alguien le pregunta "¿dónde está…?"), para
// que Mary nunca describa una pestaña que esa persona no tiene. Sin prisma
// ni nada de servidor: se importa también desde el cliente.

export const WORKSPACE_TAB_DEFS = [
  { key: "kpis", label: "KPIs financieros" },
  { key: "pagos", label: "Pagos recordatorios" },
  { key: "semanal", label: "Pedidos despachados" },
  { key: "feedback", label: "Feedback semanal" },
  { key: "procesos", label: "Procesos" },
  { key: "compras", label: "Control de Compras" },
  { key: "proveedores", label: "Proveedores" },
  { key: "llegadas", label: "Mercadería recibida" },
  { key: "nuevos-ids", label: "Nuevos IDs por brandear" },
  { key: "inventario", label: "Control de Inventario" },
  { key: "stock-actual", label: "Stock actual" },
  { key: "reingreso", label: "Reingreso de Mercadería" },
  { key: "egresos", label: "Registro de Egresos" },
  { key: "ventas-externas", label: "Ventas Externas" },
  { key: "inventoriokpis", label: "KPIs de Inventario" },
  { key: "cajachica", label: "Caja Chica" },
  { key: "pagosadmin", label: "Pagos administrativos" },
  { key: "almuerzos", label: "Almuerzos semanales" },
  { key: "postventa", label: "Servicio Postventa" },
  { key: "combos", label: "Sugerencias de Combos" },
  { key: "analisis-mercado", label: "Análisis de Mercado" },
  { key: "seguimiento-tiendas", label: "Seguimiento de tiendas" },
  { key: "plan-mejora", label: "Plan de Mejora" },
  { key: "documentos", label: "Documentos" },
  { key: "examenes", label: "Exámenes" },
  { key: "recordatorios", label: "Recordatorios" },
] as const;

export type WorkspaceTabKey = (typeof WORKSPACE_TAB_DEFS)[number]["key"];

export type WorkspaceTabFlags = {
  trackKpis: boolean;
  trackPaymentReminders: boolean;
  trackWeeklyMetric: boolean;
  trackWeeklyReview: boolean;
  canSubmitPurchases: boolean;
  canViewOwnPurchases: boolean;
  canSubmitEmergencyPurchases: boolean;
  canApprovePurchases: boolean;
  canReceivePurchases: boolean;
  canInvoicePurchases: boolean;
  canAccessSuppliers: boolean;
  canViewMarketingArrivals: boolean;
  // Pedido de Robert 2026-10-01: Marcos (notifyNewIdRealPhotos) ve "Nuevos IDs"
  // solo con lo terminado (brandeo + imágenes reales), en solo lectura.
  canViewFinishedNewIds?: boolean;
  canManageInventoryControl: boolean;
  canManageJustCatalog: boolean;
  canViewStockLevels: boolean;
  canCaptureMerchandiseReentry: boolean;
  canApproveMerchandiseReentry: boolean;
  canCloseMerchandiseReentry: boolean;
  canViewMerchandiseOutflow: boolean;
  canSubmitCancelledGuide: boolean;
  canManageCancelledGuideBatches: boolean;
  canConfirmCancelledGuideFulfillmentRemoval: boolean;
  canAssignCancelledGuideItems: boolean;
  canSubmitFulfillmentRequest: boolean;
  canViewFulfillmentRequests: boolean;
  supplierExchangeMineCount: number;
  financeWriteOffPendingCount: number;
  canConfirmFinanceWriteOff: boolean;
  canViewExternalSales: boolean;
  canViewInventoryKpisPanel: boolean;
  hasPettyCash: boolean;
  canManageStoreFeedback: boolean;
  canViewStoreFeedback: boolean;
  canSyncAtomData: boolean;
  canApproveComboSuggestions: boolean;
  canProposeMarketProduct: boolean;
  canReviewMarketProduct: boolean;
  canPublishMarketProduct: boolean;
  canViewB2BPricing: boolean;
  canViewB2CPricing: boolean;
  canViewStoreTracking: boolean;
  canManageAdminPayments: boolean;
  canRegisterLunchPayments: boolean;
  canManageImprovementPlan: boolean;
};

export function isWorkspaceTabVisible(key: WorkspaceTabKey, f: WorkspaceTabFlags): boolean {
  if (key === "kpis") return f.trackKpis;
  if (key === "pagos") return f.trackPaymentReminders;
  if (key === "semanal") return f.trackWeeklyMetric;
  if (key === "feedback") return f.trackWeeklyReview;
  if (key === "compras")
    return f.canSubmitPurchases || f.canViewOwnPurchases || f.canSubmitEmergencyPurchases || f.canApprovePurchases || f.canReceivePurchases || f.canInvoicePurchases;
  if (key === "proveedores") return f.canAccessSuppliers;
  if (key === "llegadas") return f.canViewMarketingArrivals;
  if (key === "nuevos-ids") return f.canViewMarketingArrivals || !!f.canViewFinishedNewIds;
  if (key === "inventario") return f.canManageInventoryControl;
  if (key === "stock-actual") return f.canManageJustCatalog || f.canViewStockLevels;
  if (key === "reingreso") return f.canCaptureMerchandiseReentry || f.canApproveMerchandiseReentry || f.canCloseMerchandiseReentry;
  if (key === "egresos")
    return (
      f.canViewMerchandiseOutflow ||
      f.canSubmitCancelledGuide ||
      f.canManageCancelledGuideBatches ||
      f.canConfirmCancelledGuideFulfillmentRemoval ||
      f.canAssignCancelledGuideItems ||
      f.canSubmitFulfillmentRequest ||
      f.canViewFulfillmentRequests ||
      f.supplierExchangeMineCount > 0 ||
      f.financeWriteOffPendingCount > 0 ||
      f.canConfirmFinanceWriteOff
    );
  if (key === "ventas-externas") return f.canViewExternalSales;
  if (key === "inventoriokpis") return f.canViewInventoryKpisPanel;
  if (key === "cajachica") return f.hasPettyCash;
  if (key === "postventa") return f.canManageStoreFeedback || f.canViewStoreFeedback;
  // 2026-10-01: la baja rotación ya no se anota a mano — Inventario no
  // tiene nada que hacer en Sugerencias de Combos.
  if (key === "combos") return f.canSyncAtomData || f.canApproveComboSuggestions;
  if (key === "analisis-mercado")
    return f.canProposeMarketProduct || f.canReviewMarketProduct || f.canPublishMarketProduct || f.canViewB2BPricing || f.canViewB2CPricing;
  if (key === "seguimiento-tiendas") return f.canViewStoreTracking;
  if (key === "pagosadmin") return f.canManageAdminPayments;
  if (key === "almuerzos") return f.canRegisterLunchPayments;
  if (key === "plan-mejora") return f.canManageImprovementPlan;
  return true;
}
