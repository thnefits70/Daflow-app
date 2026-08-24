import { MerchandiseReentryPanel } from "@/components/merchandise-reentry/MerchandiseReentryPanel";

// El admin nunca captura (no tiene departamento real). Puede ver
// "Revisión"/"Cierre"/"Control de Daños" para supervisar, pero fix
// 2026-08-21: aprobar lotes es exclusivo de Daniel (líder de Inventario),
// ni siquiera admin — mismo criterio que canActOnPurchaseReceiving. Fix
// 2026-08-24: subir a Just quedó exclusivo de Nairoby (canManageJustUpload
// =false) y verificar/disponer lo dañado también (canVerifyDamageDisposal
// =false) — admin ve ambas colas en modo solo lectura vía canClose.
export default function AdminMerchandiseReentryPage() {
  return (
    <MerchandiseReentryPanel
      canCapture={false}
      canApprove
      canAct={false}
      canClose
      canVerifyDamageDisposal={false}
      canManageJustUpload={false}
      canManageJustCatalog
    />
  );
}
