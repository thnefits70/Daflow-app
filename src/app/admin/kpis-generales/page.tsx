import { prisma } from "@/lib/prisma";
import { TopLine } from "@/components/ui/TopLine";
import { ReturnRatePanel } from "@/components/finance/ReturnRatePanel";
import { StockoutPanel } from "@/components/finance/StockoutPanel";
import { WarrantyPanel } from "@/components/finance/WarrantyPanel";

export default async function AdminKpisGeneralesPage() {
  const [returnRateRecords, stockoutProducts, stockoutWeekRows, stockoutConfirmations, warrantyCategories, warrantyMonthTotals, warrantyCounts] =
    await Promise.all([
      prisma.returnRateRecord.findMany({ orderBy: { month: "desc" } }),
      prisma.stockoutProduct.findMany({ orderBy: { name: "asc" } }),
      prisma.stockoutWeekProduct.findMany({
        include: { product: { select: { id: true, name: true } } },
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
      <ReturnRatePanel records={returnRateRecords} />

      <h3 className="text-[14px] font-semibold mt-7 mb-3">Ruptura de Stock</h3>
      <StockoutPanel
        products={stockoutProducts}
        weekRows={stockoutWeekRows}
        confirmedWeeks={stockoutConfirmations.map((c) => c.week)}
      />

      <h3 className="text-[14px] font-semibold mt-7 mb-3">KPI de Garantías</h3>
      <WarrantyPanel categories={warrantyCategories} monthTotals={warrantyMonthTotals} counts={warrantyCounts} />
    </div>
  );
}
