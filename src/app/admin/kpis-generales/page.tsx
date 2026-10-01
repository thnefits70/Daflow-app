import { prisma } from "@/lib/prisma";
import { getStockoutWeekDetails } from "@/lib/dashboard";
import { TopLine } from "@/components/ui/TopLine";
import { ReturnRatePanel } from "@/components/finance/ReturnRatePanel";
import { StockoutPanel } from "@/components/finance/StockoutPanel";
import { WarrantyPanel } from "@/components/finance/WarrantyPanel";
import { CurrentWinnersPanel } from "@/components/finance/CurrentWinnersPanel";
import { TabGuide } from "@/components/shared/TabGuide";

export default async function AdminKpisGeneralesPage() {
  const [returnRateRecords, stockoutWeeks, warrantyCategories, warrantyMonthTotals, warrantyCounts] =
    await Promise.all([
      prisma.returnRateRecord.findMany({ orderBy: { month: "desc" } }),
      getStockoutWeekDetails(),
      prisma.warrantyCategory.findMany({ orderBy: { name: "asc" } }),
      prisma.warrantyMonthTotal.findMany({ orderBy: { month: "desc" } }),
      prisma.warrantyCategoryMonthCount.findMany({
        orderBy: [{ month: "desc" }],
        include: { category: { select: { id: true, name: true } } },
      }),
    ]);

  return (
    <div>
      <TopLine eyebrow="Finanzas" title="KPIs Generales" />

      <h3 className="text-[14px] font-semibold mb-3">Tasa de Devolución</h3>
      <TabGuide storageKey="kpis-generales-devolucion">
        Cada mes registra aquí el % de devolución de esa área. Guardar un mes que ya existe reemplaza su valor anterior — no crea uno duplicado. El estado se calcula solo: menos de 20% es Saludable, 20-30% es Alerta, más de 30% es Extremadamente alta.
      </TabGuide>
      <ReturnRatePanel records={returnRateRecords} />

      <h3 className="text-[14px] font-semibold mt-7 mb-3">Ruptura de Stock</h3>
      <TabGuide storageKey="kpis-generales-stock">
        Se llena sola con los cortes de Fulfillment: si Daniel confirma que de un producto salió menos de lo pedido, ese producto cuenta como ruptura en esa semana. Las semanas hasta la 39 quedan como se cargaron a mano.
      </TabGuide>
      <StockoutPanel weeks={stockoutWeeks} />

      <h3 className="text-[14px] font-semibold mt-7 mb-3">Productos ganadores</h3>
      <TabGuide storageKey="kpis-generales-topmovers">
        Se llena sola con los cortes: no hay que subir ningún reporte. Estos ganadores se usan para armar Sugerencias de Combos.
      </TabGuide>
      <CurrentWinnersPanel />

      <h3 className="text-[14px] font-semibold mt-7 mb-3">KPI de Garantías</h3>
      <TabGuide storageKey="kpis-generales-garantias">
        Desde octubre 2026 se llena sola con los cortes: cada garantía que Yair marca en las guías de Dropi suma al total del mes, con su motivo. Los meses anteriores quedan como se cargaron a mano.
      </TabGuide>
      <WarrantyPanel categories={warrantyCategories} monthTotals={warrantyMonthTotals} counts={warrantyCounts} />
    </div>
  );
}
