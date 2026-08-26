import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { TopLine } from "@/components/ui/TopLine";
import { PushTypeToggle } from "@/components/shared/PushTypeToggle";
import { ReturnRatePanel } from "@/components/finance/ReturnRatePanel";
import { StockoutPanel } from "@/components/finance/StockoutPanel";
import { WarrantyPanel } from "@/components/finance/WarrantyPanel";
import { TabGuide } from "@/components/shared/TabGuide";
import { canManageReturnRate, canManageStockouts, canManageWarranties } from "@/lib/guards";

export default async function AreaKpisGeneralesPage() {
  const session = await auth();
  if (!session) redirect("/login");

  const [canReturnRate, canStockouts, canWarranties] = await Promise.all([
    canManageReturnRate(),
    canManageStockouts(),
    canManageWarranties(),
  ]);

  const [returnRateRecords, stockoutProducts, stockoutWeekRows, stockoutConfirmations, warrantyCategories, warrantyMonthTotals, warrantyCounts] =
    await Promise.all([
      canReturnRate ? prisma.returnRateRecord.findMany({ orderBy: { month: "desc" } }) : Promise.resolve([]),
      canStockouts ? prisma.stockoutProduct.findMany({ orderBy: { name: "asc" } }) : Promise.resolve([]),
      canStockouts
        ? prisma.stockoutWeekProduct.findMany({
            include: { product: { select: { id: true, name: true } } },
            orderBy: [{ week: "desc" }, { createdAt: "asc" }],
          })
        : Promise.resolve([]),
      canStockouts ? prisma.stockoutWeekConfirmation.findMany({ select: { week: true } }) : Promise.resolve([]),
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

      {canStockouts && (
        <>
          <div className={`flex items-center justify-between gap-2 mb-3 ${canReturnRate ? "mt-7" : ""}`}>
            <h3 className="text-[14px] font-semibold">Ruptura de Stock</h3>
            <PushTypeToggle type="ruptura_stock" />
          </div>
          <TabGuide storageKey="kpis-generales-stock">
            Cada semana, marca aquí cada producto que se quedó sin stock (si escribes el mismo nombre de uno ya registrado, se reutiliza en vez de crear otro). Si esa semana no faltó ningún producto, usa el botón &quot;Confirmar: sin productos agotados esa semana&quot; en vez de dejarla en blanco — así el sistema distingue &quot;no hubo ruptura&quot; de &quot;nadie revisó&quot;.
          </TabGuide>
          <StockoutPanel
            products={stockoutProducts}
            weekRows={stockoutWeekRows}
            confirmedWeeks={stockoutConfirmations.map((c) => c.week)}
          />
        </>
      )}

      {canWarranties && (
        <>
          <div className={`flex items-center justify-between gap-2 mb-3 ${canReturnRate || canStockouts ? "mt-7" : ""}`}>
            <h3 className="text-[14px] font-semibold">KPI de Garantías</h3>
            <PushTypeToggle type="kpi_garantias" />
          </div>
          <TabGuide storageKey="kpis-generales-garantias">
            Registra el total de garantías ingresadas ese mes, y opcionalmente desglósalo por categoría de producto (el conteo por categoría es aparte del total — ambos se guardan por mes).
          </TabGuide>
          <WarrantyPanel categories={warrantyCategories} monthTotals={warrantyMonthTotals} counts={warrantyCounts} />
        </>
      )}
    </div>
  );
}
