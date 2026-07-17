import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { TopLine } from "@/components/ui/TopLine";
import { ReturnRatePanel } from "@/components/finance/ReturnRatePanel";
import { StockoutPanel } from "@/components/finance/StockoutPanel";
import { canManageReturnRate, canManageStockouts } from "@/lib/guards";

export default async function AreaKpisGeneralesPage() {
  const [canReturnRate, canStockouts] = await Promise.all([canManageReturnRate(), canManageStockouts()]);
  if (!canReturnRate && !canStockouts) redirect("/area");

  const [returnRateRecords, stockoutProducts, stockoutWeekRows] = await Promise.all([
    canReturnRate ? prisma.returnRateRecord.findMany({ orderBy: { month: "desc" } }) : Promise.resolve([]),
    canStockouts ? prisma.stockoutProduct.findMany({ orderBy: { name: "asc" } }) : Promise.resolve([]),
    canStockouts
      ? prisma.stockoutWeekProduct.findMany({
          include: { product: { select: { id: true, name: true } } },
          orderBy: [{ week: "desc" }, { createdAt: "asc" }],
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
          <StockoutPanel products={stockoutProducts} weekRows={stockoutWeekRows} />
        </>
      )}
    </div>
  );
}
