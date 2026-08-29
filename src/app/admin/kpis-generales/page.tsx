import { prisma } from "@/lib/prisma";
import { TopLine } from "@/components/ui/TopLine";
import { ReturnRatePanel } from "@/components/finance/ReturnRatePanel";
import { StockoutPanel } from "@/components/finance/StockoutPanel";
import { WarrantyPanel } from "@/components/finance/WarrantyPanel";
import { TabGuide } from "@/components/shared/TabGuide";

export default async function AdminKpisGeneralesPage() {
  const [returnRateRecords, stockoutWeekRows, stockoutConfirmations, warrantyCategories, warrantyMonthTotals, warrantyCounts] =
    await Promise.all([
      prisma.returnRateRecord.findMany({ orderBy: { month: "desc" } }),
      prisma.stockoutWeekProduct.findMany({
        include: { product: { select: { id: true, name: true, catalogItem: { select: { justCode: true } } } } },
        orderBy: [{ week: "desc" }, { createdAt: "asc" }],
      }),
      prisma.stockoutWeekConfirmation.findMany({ select: { week: true } }),
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
        Cada semana, busca y marca aquí cada producto que se quedó sin stock — el mismo catálogo (con su código de Just) que usan Reingreso, Compras y Ventas Externas, así que ya no hay que escribir el nombre a mano ni el riesgo de duplicarlo por un error de tipeo. Si esa semana no faltó ningún producto, usa el botón &quot;Confirmar: sin productos agotados esa semana&quot; en vez de dejarla en blanco — así el sistema distingue &quot;no hubo ruptura&quot; de &quot;nadie revisó&quot;.
      </TabGuide>
      <StockoutPanel
        weekRows={stockoutWeekRows}
        confirmedWeeks={stockoutConfirmations.map((c) => c.week)}
      />

      <h3 className="text-[14px] font-semibold mt-7 mb-3">KPI de Garantías</h3>
      <TabGuide storageKey="kpis-generales-garantias">
        Registra el total de garantías ingresadas ese mes, y opcionalmente desglósalo por categoría de producto (el conteo por categoría es aparte del total — ambos se guardan por mes).
      </TabGuide>
      <WarrantyPanel categories={warrantyCategories} monthTotals={warrantyMonthTotals} counts={warrantyCounts} />
    </div>
  );
}
