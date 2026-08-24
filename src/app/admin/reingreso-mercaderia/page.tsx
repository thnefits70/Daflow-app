import { MerchandiseReentryPanel } from "@/components/merchandise-reentry/MerchandiseReentryPanel";

// El admin nunca captura (no tiene departamento real). Puede ver
// "Revisión"/"Cierre" para supervisar, pero fix 2026-08-21: aprobar lotes es
// exclusivo de Daniel (líder de Inventario), ni siquiera admin — mismo
// criterio que canActOnPurchaseReceiving. Fix 2026-08-24: subir a Just
// también quedó exclusivo de Nairoby/Daniel — admin ve "Cierre" (canClose
// sigue true) pero en modo solo lectura (canManageJustUpload=false).
export default function AdminMerchandiseReentryPage() {
  return <MerchandiseReentryPanel canCapture={false} canApprove canAct={false} canClose canManageJustUpload={false} canManageJustCatalog />;
}
