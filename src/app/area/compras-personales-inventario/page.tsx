import { redirect, notFound } from "next/navigation";
import { auth } from "@/auth";
import { TopLine } from "@/components/ui/TopLine";
import { canConfirmPersonalPurchaseInventory } from "@/lib/guards";
import { PersonalPurchasesInventoryPanel } from "@/components/personal-purchases/PersonalPurchasesInventoryPanel";
import { RetailProductCatalogPanel } from "@/components/personal-purchases/RetailProductCatalogPanel";

// Confirmado 2026-08-18: la cola de confirmación de Daniel — su
// confirmación es lo que habilita el retiro físico de bodega.
export default async function ComprasPersonalesInventarioPage() {
  const session = await auth();
  if (!session) redirect("/login");
  if (!(await canConfirmPersonalPurchaseInventory())) notFound();

  return (
    <div>
      <TopLine eyebrow="Inventario" title="Compras personales — confirmar" />
      <PersonalPurchasesInventoryPanel />
      <div className="mt-5">
        <RetailProductCatalogPanel />
      </div>
    </div>
  );
}
