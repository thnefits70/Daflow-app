import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { TopLine } from "@/components/ui/TopLine";
import { PushTypeToggle } from "@/components/shared/PushTypeToggle";
import { ReturnRatePanel } from "@/components/finance/ReturnRatePanel";
import { WarrantyPanel } from "@/components/finance/WarrantyPanel";
import { TabGuide } from "@/components/shared/TabGuide";
import { canManageReturnRate, canManageWarranties, canViewReturnRateDetail } from "@/lib/guards";
import { AutoReturnRatePanel } from "@/components/finance/AutoReturnRatePanel";
import { isLastManualWarrantyMonthDone } from "@/lib/warrantyKpi";
import { RETURN_RATE_LAST_MANUAL_MONTH } from "@/lib/returnRateConstants";

export default async function AreaKpisGeneralesPage() {
  const session = await auth();
  if (!session) redirect("/login");

  const [canReturnRateDetail, canManageReturnRateKpi, canManageWarrantyKpi, lastManualReturnMonth, lastManualWarrantyMonth] = await Promise.all([
    canViewReturnRateDetail(),
    canManageReturnRate(),
    canManageWarranties(),
    prisma.returnRateRecord.findUnique({ where: { month: RETURN_RATE_LAST_MANUAL_MONTH }, select: { id: true } }),
    isLastManualWarrantyMonthDone(),
  ]);
  // Pedido del usuario 2026-09-30: igual que Garantías, la Tasa de Devolución
  // se calcula sola desde octubre 2026 — solo aparece hasta que se copia de
  // ATOM septiembre (el último mes a mano). El resultado automático lo ve el
  // admin en /admin/kpis-generales y en el gráfico de Inicio.
  const canReturnRate = canManageReturnRateKpi && !lastManualReturnMonth;
  // Pedido del usuario 2026-09-30: desde octubre 2026 el KPI de Garantías se
  // llena solo. La sección solo se muestra hasta que se carga a mano el
  // último mes manual (septiembre 2026); después desaparece de esta pantalla
  // (el admin la sigue viendo en /admin/kpis-generales).
  const canWarranties = canManageWarrantyKpi && !lastManualWarrantyMonth;

  const [returnRateRecords, warrantyCategories, warrantyMonthTotals, warrantyCounts] =
    await Promise.all([
      canReturnRate ? prisma.returnRateRecord.findMany({ orderBy: { month: "desc" } }) : Promise.resolve([]),
      canWarranties ? prisma.warrantyCategory.findMany({ orderBy: { name: "asc" } }) : Promise.resolve([]),
      canWarranties ? prisma.warrantyMonthTotal.findMany({ orderBy: { month: "desc" } }) : Promise.resolve([]),
      canWarranties
        ? prisma.warrantyCategoryMonthCount.findMany({
            orderBy: [{ month: "desc" }],
            include: { category: { select: { id: true, name: true } } },
          })
        : Promise.resolve([]),
    ]);

  return (
    <div>
      <TopLine eyebrow="Finanzas" title="KPIs Generales" />

      {canReturnRate && (
        <>
          <div className="flex items-center justify-between gap-2 mb-3">
            <h3 className="text-[14px] font-semibold">Tasa de Devolución</h3>
            <PushTypeToggle type="tasa_devolucion" />
          </div>
          <TabGuide storageKey="kpis-generales-devolucion">
            Solo falta copiar de ATOM el % de septiembre 2026. Cuando lo guardes, esta sección desaparece: desde octubre la tasa se calcula sola con los cortes y las devoluciones.
          </TabGuide>
          <ReturnRatePanel records={returnRateRecords} lastManualOnly />
        </>
      )}

      {/* Pedido del usuario 2026-10-01: el detalle completo (cada mes, por
          marca y todos los productos) lo ven todos los líderes y todo
          Análisis de Mercado. */}
      {canReturnRateDetail && (
        <>
          <h3 className={`text-[14px] font-semibold mb-3 ${canReturnRate ? "mt-7" : ""}`}>Tasa de Devolución — detalle</h3>
          <AutoReturnRatePanel />
        </>
      )}

      {/* Pedido del usuario 2026-09-30: Ruptura de Stock y Productos ganadores
          se llenan solos con los cortes — ya no se muestran acá para que
          Daniel (quien antes los cargaba) no piense que tiene algo que hacer.
          Siguen visibles para el admin en /admin/kpis-generales. */}
      {canWarranties && (
        <>
          <div className={`flex items-center justify-between gap-2 mb-3 ${canReturnRate || canReturnRateDetail ? "mt-7" : ""}`}>
            <h3 className="text-[14px] font-semibold">KPI de Garantías</h3>
            <PushTypeToggle type="kpi_garantias" />
          </div>
          <TabGuide storageKey="kpis-generales-garantias">
            Solo falta cargar a mano septiembre 2026 (total y motivos). Cuando lo guardes, esta sección desaparece: desde octubre se llena sola con los cortes.
          </TabGuide>
          <WarrantyPanel categories={warrantyCategories} monthTotals={warrantyMonthTotals} counts={warrantyCounts} startOnLastManualMonth />
        </>
      )}
    </div>
  );
}
