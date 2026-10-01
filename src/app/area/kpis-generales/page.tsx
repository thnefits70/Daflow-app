import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { TopLine } from "@/components/ui/TopLine";
import { PushTypeToggle } from "@/components/shared/PushTypeToggle";
import { ReturnRatePanel } from "@/components/finance/ReturnRatePanel";
import { WarrantyPanel } from "@/components/finance/WarrantyPanel";
import { TabGuide } from "@/components/shared/TabGuide";
import { canManageReturnRate, canManageWarranties } from "@/lib/guards";

export default async function AreaKpisGeneralesPage() {
  const session = await auth();
  if (!session) redirect("/login");

  const [canReturnRate, canWarranties] = await Promise.all([canManageReturnRate(), canManageWarranties()]);

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
            Cada mes registra aquí el % de devolución de esa área. Guardar un mes que ya existe reemplaza su valor anterior — no crea uno duplicado. El estado se calcula solo: menos de 20% es Saludable, 20-30% es Alerta, más de 30% es Extremadamente alta.
          </TabGuide>
          <ReturnRatePanel records={returnRateRecords} />
        </>
      )}

      {/* Pedido del usuario 2026-09-30: Ruptura de Stock y Productos ganadores
          se llenan solos con los cortes — ya no se muestran acá para que
          Daniel (quien antes los cargaba) no piense que tiene algo que hacer.
          Siguen visibles para el admin en /admin/kpis-generales. */}
      {canWarranties && (
        <>
          <div className={`flex items-center justify-between gap-2 mb-3 ${canReturnRate ? "mt-7" : ""}`}>
            <h3 className="text-[14px] font-semibold">KPI de Garantías</h3>
            <PushTypeToggle type="kpi_garantias" />
          </div>
          <TabGuide storageKey="kpis-generales-garantias">
            Desde octubre 2026 se llena sola con los cortes: cada garantía que Yair marca en las guías de Dropi suma al total del mes, con su motivo. Los meses anteriores quedan como se cargaron a mano.
          </TabGuide>
          <WarrantyPanel categories={warrantyCategories} monthTotals={warrantyMonthTotals} counts={warrantyCounts} />
        </>
      )}
    </div>
  );
}
