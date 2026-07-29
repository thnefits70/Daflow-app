import { redirect } from "next/navigation";
import { canSubmitPurchaseRequests, canConfirmPurchaseReceiving, canRegisterPurchaseInvoices } from "@/lib/guards";
import { PurchaseControlPanel } from "@/components/purchases/PurchaseControlPanel";

export default async function ControlDeComprasPage() {
  const [canSubmit, canReceive, canInvoice] = await Promise.all([
    canSubmitPurchaseRequests(),
    canConfirmPurchaseReceiving(),
    canRegisterPurchaseInvoices(),
  ]);
  if (!canSubmit && !canReceive && !canInvoice) redirect("/area");

  return (
    <div>
      <div className="font-mono text-[10.5px] tracking-[.14em] uppercase text-steel mb-1">Compras · Inventario · Finanzas</div>
      <h2 className="font-display text-[24px] mb-5">Control de Compras</h2>
      <PurchaseControlPanel canSubmit={canSubmit} canReview={false} canReceive={canReceive} canInvoice={canInvoice} />
    </div>
  );
}
