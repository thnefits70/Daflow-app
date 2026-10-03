import { prisma } from "@/lib/prisma";
import { TopLine } from "@/components/ui/TopLine";
import { ReturnRatePanel } from "@/components/finance/ReturnRatePanel";
import { AutoReturnRatePanel } from "@/components/finance/AutoReturnRatePanel";
import { WarrantyPanel } from "@/components/finance/WarrantyPanel";
import { TabGuide } from "@/components/shared/TabGuide";
import { isLastManualWarrantyMonthDone } from "@/lib/warrantyKpi";
import { RETURN_RATE_LAST_MANUAL_MONTH } from "@/lib/returnRateConstants";

// Pedido del usuario 2026-09-30: acá ya no se carga nada a mano desde
// octubre 2026. Ruptura de Stock y Productos ganadores se llenan solos (sus
// resultados están en los gráficos de Inicio). La Tasa de Devolución se
// calcula sola (general, por marca y por producto); su formulario y el del
// KPI de Garantías solo aparecen hasta que se carga septiembre, el último
// mes a mano.
export default async function AdminKpisGeneralesPage() {
  const [returnRateRecords, lastManualReturnMonth, lastManualWarrantyMonth] = await Promise.all([
    prisma.returnRateRecord.findMany({ orderBy: { month: "desc" } }),
    prisma.returnRateRecord.findUnique({ where: { month: RETURN_RATE_LAST_MANUAL_MONTH }, select: { id: true } }),
    isLastManualWarrantyMonthDone(),
  ]);
  const showWarranties = !lastManualWarrantyMonth;
  const [warrantyCategories, warrantyMonthTotals, warrantyCounts] = showWarranties
    ? await Promise.all([
        prisma.warrantyCategory.findMany({ orderBy: { name: "asc" } }),
        prisma.warrantyMonthTotal.findMany({ orderBy: { month: "desc" } }),
        prisma.warrantyCategoryMonthCount.findMany({
          orderBy: [{ month: "desc" }],
          include: { category: { select: { id: true, name: true } } },
        }),
      ])
    : [[], [], []];

  return (
    <div>
      <TopLine eyebrow="Finanzas" title="KPIs Generales" />

      <h3 className="text-[14px] font-semibold mb-3">Tasa de Devolución</h3>
      {!lastManualReturnMonth && <ReturnRatePanel records={returnRateRecords} lastManualOnly />}
      <AutoReturnRatePanel />

      {showWarranties && (
        <>
          <h3 className="text-[14px] font-semibold mt-7 mb-3">KPI de Garantías</h3>
          <TabGuide storageKey="kpis-generales-garantias">
            Solo falta cargar a mano septiembre 2026 (total y motivos). Cuando se guarde, esta sección desaparece: desde octubre se llena sola con los cortes.
          </TabGuide>
          <WarrantyPanel categories={warrantyCategories} monthTotals={warrantyMonthTotals} counts={warrantyCounts} startOnLastManualMonth />
        </>
      )}
    </div>
  );
}
