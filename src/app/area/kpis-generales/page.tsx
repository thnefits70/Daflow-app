import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { TopLine } from "@/components/ui/TopLine";
import { ReturnRatePanel } from "@/components/finance/ReturnRatePanel";
import { StockoutPanel } from "@/components/finance/StockoutPanel";
import { WarrantyPanel } from "@/components/finance/WarrantyPanel";
import { canManageReturnRate, canManageStockouts, canManageWarranties } from "@/lib/guards";

export default async function AreaKpisGeneralesPage() {
  const [canReturnRate, canStockouts, canWarranties] = await Promise.all([
    canManageReturnRate(),
    canManageStockouts(),
    canManageWarranties(),
  ]);
  if (!canReturnRate && !canStockouts && !canWarranties) redirect("/area");

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
          <h3 className="text-[14px] font-semibold mb-3">Tasa de Devolución</h3>
          <ReturnRatePanel records={returnRateRecords} />
        </>
      )}

      {canStockouts && (
        <>
          <h3 className={`text-[14px] font-semibold mb-3 ${canReturnRate ? "mt-7" : ""}`}>Ruptura de Stock</h3>
          <StockoutPanel
            products={stockoutProducts}
            weekRows={stockoutWeekRows}
            confirmedWeeks={stockoutConfirmations.map((c) => c.week)}
          />
        </>
      )}

      {canWarranties && (
        <>
          <h3 className={`text-[14px] font-semibold mb-3 ${canReturnRate || canStockouts ? "mt-7" : ""}`}>KPI de Garantías</h3>
          <WarrantyPanel categories={warrantyCategories} monthTotals={warrantyMonthTotals} counts={warrantyCounts} />
        </>
      )}
    </div>
  );
}
