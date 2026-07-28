import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { TopLine } from "@/components/ui/TopLine";
import { PushTypeToggle } from "@/components/shared/PushTypeToggle";
import { ReturnRatePanel } from "@/components/finance/ReturnRatePanel";
import { StockoutPanel } from "@/components/finance/StockoutPanel";
import { WarrantyPanel } from "@/components/finance/WarrantyPanel";
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
          <ReturnRatePanel records={returnRateRecords} />
        </>
      )}

      {canStockouts && (
        <>
          <div className={`flex items-center justify-between gap-2 mb-3 ${canReturnRate ? "mt-7" : ""}`}>
            <h3 className="text-[14px] font-semibold">Ruptura de Stock</h3>
            <PushTypeToggle type="ruptura_stock" />
          </div>
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
          <WarrantyPanel categories={warrantyCategories} monthTotals={warrantyMonthTotals} counts={warrantyCounts} />
        </>
      )}
    </div>
  );
}
