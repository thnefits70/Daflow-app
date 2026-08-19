import { MerchandiseReentryPanel } from "@/components/merchandise-reentry/MerchandiseReentryPanel";

// El admin nunca captura (no tiene departamento real), pero sí puede
// aprobar/cerrar como supervisión general — mismo criterio que
// canRegisterPurchaseInvoices.
export default function AdminMerchandiseReentryPage() {
  return <MerchandiseReentryPanel canCapture={false} canApprove canClose />;
}
