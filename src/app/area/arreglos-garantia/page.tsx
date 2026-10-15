import { redirect, notFound } from "next/navigation";
import { auth } from "@/auth";
import { TopLine } from "@/components/ui/TopLine";
import { TabGuide } from "@/components/shared/TabGuide";
import { getArrangementRole } from "@/lib/warrantyArrangements";
import { WarrantyArrangementsPanel } from "@/components/warranty-arrangements/WarrantyArrangementsPanel";

// Arreglos de garantía (pedido de Bryan 2026-10-15): Michelle y Yair
// registran, Bryan aprueba los arreglos en dinero, Daniel anota la guía de
// los reenvíos ya pagados por el dropshipper.
export default async function ArreglosGarantiaPage() {
  const session = await auth();
  if (!session) redirect("/login");
  if (!(await getArrangementRole())) notFound();
  return (
    <div>
      <TopLine eyebrow="Garantías" title="Arreglos de garantía" />
      <TabGuide storageKey="arreglos-garantia">
        Dos casos: (1) reenvío cuando el dropshipper gestionó mal — él paga el flete exacto antes (wallet de Dropi o transferencia), el admin verifica el pago y recién ahí Daniel genera la guía; (2) arreglo en dinero cuando el cliente acepta un monto en vez de la garantía y se queda con el producto — Bryan aprueba y el admin paga. El arreglo nunca puede costar más que 2 fletes + el producto.
      </TabGuide>
      <WarrantyArrangementsPanel />
    </div>
  );
}
