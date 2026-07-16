import { prisma } from "@/lib/prisma";
import { TopLine } from "@/components/ui/TopLine";
import { ReturnRatePanel } from "@/components/finance/ReturnRatePanel";

export default async function AdminTasaDevolucionPage() {
  const records = await prisma.returnRateRecord.findMany({ orderBy: { month: "desc" } });

  return (
    <div>
      <TopLine eyebrow="Finanzas" title="Tasa de Devolución General" />
      <ReturnRatePanel records={records} />
    </div>
  );
}
