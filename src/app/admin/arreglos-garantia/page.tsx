import { TopLine } from "@/components/ui/TopLine";
import { WarrantyArrangementsPanel } from "@/components/warranty-arrangements/WarrantyArrangementsPanel";
import { RocketWarrantiesPanel } from "@/components/warranty-arrangements/RocketWarrantiesPanel";

// Arreglos de garantía (2026-10-15): el admin verifica el pago del flete del
// dropshipper y paga los arreglos en dinero desde la cuenta principal.
export default function AdminArreglosGarantiaPage() {
  return (
    <div>
      <TopLine eyebrow="Garantías" title="Arreglos de garantía" />
      <WarrantyArrangementsPanel />
      {/* Garantías de Rocket por orden de Dropi (2026-10-16). */}
      <div className="mt-8">
        <RocketWarrantiesPanel />
      </div>
    </div>
  );
}
