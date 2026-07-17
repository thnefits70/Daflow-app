import { prisma } from "@/lib/prisma";
import { TopLine } from "@/components/ui/TopLine";
import { ReturnRatePanel } from "@/components/finance/ReturnRatePanel";
import { StockoutPanel } from "@/components/finance/StockoutPanel";

export default async function AdminKpisGeneralesPage() {
  const [returnRateRecords, stockoutProducts, stockoutWeekRows] = await Promise.all([
    prisma.returnRateRecord.findMany({ orderBy: { month: "desc" } }),
    prisma.stockoutProduct.findMany({ orderBy: { name: "asc" } }),
    prisma.stockoutWeekProduct.findMany({
      include: { product: { select: { id: true, name: true } } },
      orderBy: [{ week: "desc" }, { createdAt: "asc" }],
    }),
  ]);

  return (
    <div>
      <TopLine eyebrow="Finanzas" title="KPIs Generales" />

      <h3 className="text-[14px] font-semibold mb-3">Tasa de Devolución</h3>
      <ReturnRatePanel records={returnRateRecords} />

      <h3 className="text-[14px] font-semibold mt-7 mb-3">Ruptura de Stock</h3>
      <StockoutPanel products={stockoutProducts} weekRows={stockoutWeekRows} />
    </div>
  );
}
