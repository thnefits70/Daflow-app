import { prisma } from "@/lib/prisma";
import { TopLine } from "@/components/ui/TopLine";
import { ReturnRatePanel } from "@/components/finance/ReturnRatePanel";
import { WarrantyPanel } from "@/components/finance/WarrantyPanel";
import { TabGuide } from "@/components/shared/TabGuide";
import { WARRANTY_LAST_MANUAL_MONTH } from "@/lib/warrantyKpiConstants";

// Pedido del usuario 2026-09-30: acá solo queda lo que alguien carga a mano.
// Ruptura de Stock y Productos ganadores se llenan solos con los cortes (sus
// resultados se ven en los gráficos de Inicio), y el KPI de Garantías
// también desde octubre 2026 — su sección solo aparece hasta que se carga
// septiembre, el último mes a mano.
export default async function AdminKpisGeneralesPage() {
  const [returnRateRecords, lastManualWarrantyMonth] = await Promise.all([
    prisma.returnRateRecord.findMany({ orderBy: { month: "desc" } }),
    prisma.warrantyMonthTotal.findUnique({ where: { month: WARRANTY_LAST_MANUAL_MONTH }, select: { id: true } }),
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
      <TabGuide storageKey="kpis-generales-devolucion">
        Cada mes registra aquí el % de devolución de esa área. Guardar un mes que ya existe reemplaza su valor anterior — no crea uno duplicado. El estado se calcula solo: menos de 20% es Saludable, 20-30% es Alerta, más de 30% es Extremadamente alta.
      </TabGuide>
      <ReturnRatePanel records={returnRateRecords} />

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
