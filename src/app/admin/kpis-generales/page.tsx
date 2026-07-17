import { prisma } from "@/lib/prisma";
import { TopLine } from "@/components/ui/TopLine";
import { ReturnRatePanel } from "@/components/finance/ReturnRatePanel";

export default async function AdminKpisGeneralesPage() {
  const records = await prisma.returnRateRecord.findMany({ orderBy: { month: "desc" } });

  return (
    <div>
      <TopLine eyebrow="Finanzas" title="KPIs Generales" />
      <h3 className="text-[14px] font-semibold mb-3">Tasa de Devolución</h3>
      <ReturnRatePanel records={records} />
    </div>
  );
}
