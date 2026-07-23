import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { TopLine } from "@/components/ui/TopLine";
import { ReturnRatePanel } from "@/components/finance/ReturnRatePanel";
import { StockoutPanel } from "@/components/finance/StockoutPanel";
import { WarrantyPanel } from "@/components/finance/WarrantyPanel";
import { StoreFeedbackPanel } from "@/components/finance/StoreFeedbackPanel";
import { StoreFeedbackTile } from "@/components/dashboard/StoreFeedbackTile";
import { canManageReturnRate, canManageStockouts, canManageWarranties, canManageStoreFeedback } from "@/lib/guards";
import { getStoreFeedbackData, getStoreFeedbackAggregate } from "@/lib/storeFeedback";

export default async function AreaKpisGeneralesPage() {
  const session = await auth();
  if (!session) redirect("/login");

  const [canReturnRate, canStockouts, canWarranties, canStoreFeedback] = await Promise.all([
    canManageReturnRate(),
    canManageStockouts(),
    canManageWarranties(),
    canManageStoreFeedback(),
  ]);

  const [returnRateRecords, stockoutProducts, stockoutWeekRows, stockoutConfirmations, warrantyCategories, warrantyMonthTotals, warrantyCounts, storeFeedbackAggregate, stores] =
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
      // Public — every logged-in employee sees this aggregate, unlike the other sections.
      getStoreFeedbackAggregate(),
      canStoreFeedback ? getStoreFeedbackData() : Promise.resolve([]),
    ]);

  return (
    <div>
      <TopLine eyebrow="Finanzas" title="KPIs Generales" />

      <h3 className="text-[14px] font-semibold mb-3">Servicio Postventa</h3>
      {storeFeedbackAggregate ? (
        <div className="max-w-sm mb-3">
          <StoreFeedbackTile data={storeFeedbackAggregate} />
        </div>
      ) : (
        <div className="text-steel text-[13px] mb-3">Todavía no hay evaluaciones registradas.</div>
      )}
      {canStoreFeedback && <StoreFeedbackPanel stores={stores} />}

      {canReturnRate && (
        <>
          <h3 className="text-[14px] font-semibold mb-3 mt-7">Tasa de Devolución</h3>
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
