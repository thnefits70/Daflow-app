import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getStockoutWeekDetails } from "@/lib/dashboard";
import { TopLine } from "@/components/ui/TopLine";
import { PushTypeToggle } from "@/components/shared/PushTypeToggle";
import { ReturnRatePanel } from "@/components/finance/ReturnRatePanel";
import { StockoutPanel } from "@/components/finance/StockoutPanel";
import { WarrantyPanel } from "@/components/finance/WarrantyPanel";
import { MonthlyTopMoversPanel } from "@/components/finance/MonthlyTopMoversPanel";
import { TabGuide } from "@/components/shared/TabGuide";
import { canManageReturnRate, canManageStockouts, canManageWarranties, canManageInventoryControl } from "@/lib/guards";

export default async function AreaKpisGeneralesPage() {
  const session = await auth();
  if (!session) redirect("/login");

  const [canReturnRate, canStockouts, canWarranties, canTopMovers] = await Promise.all([
    canManageReturnRate(),
    canManageStockouts(),
    canManageWarranties(),
    canManageInventoryControl(),
  ]);

  const [returnRateRecords, stockoutWeeks, warrantyCategories, warrantyMonthTotals, warrantyCounts] =
    await Promise.all([
      canReturnRate ? prisma.returnRateRecord.findMany({ orderBy: { month: "desc" } }) : Promise.resolve([]),
      canStockouts ? getStockoutWeekDetails() : Promise.resolve([]),
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
            Se llena sola con los cortes de Fulfillment: si Daniel confirma que de un producto salió menos de lo pedido, ese producto cuenta como ruptura en esa semana. Las semanas hasta la 39 quedan como se cargaron a mano.
          </TabGuide>
          <StockoutPanel weeks={stockoutWeeks} />
        </>
      )}

      {canTopMovers && (
        <>
          <div className={`flex items-center justify-between gap-2 mb-3 ${canReturnRate || canStockouts ? "mt-7" : ""}`}>
            <h3 className="text-[14px] font-semibold">Productos ganadores del mes</h3>
          </div>
          <TabGuide storageKey="kpis-generales-topmovers">
            Una vez al mes (ideal: los primeros 3 días), sube el reporte de productos con 200+ movimientos ese mes. Estos ganadores se suman a los de ATOM para armar Sugerencias de Combos — mientras más productos ganadores tenga el sistema, más opciones de combos puede sugerir.
          </TabGuide>
          <MonthlyTopMoversPanel />
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
