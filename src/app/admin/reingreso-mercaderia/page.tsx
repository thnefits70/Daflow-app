import { MerchandiseReentryPanel } from "@/components/merchandise-reentry/MerchandiseReentryPanel";

// El admin nunca captura (no tiene departamento real). Puede ver
// "Revisión"/"Control de Daños" para supervisar, pero fix
// 2026-08-21: aprobar lotes es exclusivo de Daniel (líder de Inventario),
// ni siquiera admin — mismo criterio que canActOnPurchaseReceiving. Fix
// 2026-08-24: verificar/disponer lo dañado quedó exclusivo de Nairoby
// (canVerifyDamageDisposal=false) — admin lo ve en modo solo lectura vía
// canClose.
export default function AdminMerchandiseReentryPage() {
  return (
    <MerchandiseReentryPanel
      canCapture={false}
      canApprove
      canAct={false}
      canClose
      canVerifyDamageDisposal={false}
      canManageJustCatalog
    />
  );
}
