import { PurchaseControlPanel } from "@/components/purchases/PurchaseControlPanel";

// AdminLayout ya exige role === "admin" — admin ve las 5 pestañas: puede
// solicitar (ej. para Nairoby si algún día usa la sesión admin), aprueba,
// y también puede cubrir Inventario/Finanzas si hiciera falta.
export default function AdminControlDeComprasPage() {
  return (
    <div>
      <div className="font-mono text-[10.5px] tracking-[.14em] uppercase text-steel mb-1">Compras · Inventario · Finanzas</div>
      <h2 className="font-display text-[24px] mb-5">Control de Compras</h2>
      <PurchaseControlPanel canSubmit canReview canReceive canInvoice />
    </div>
  );
}
