import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { TopLine } from "@/components/ui/TopLine";
import { ReturnRatePanel } from "@/components/finance/ReturnRatePanel";
import { canManageReturnRate } from "@/lib/guards";

export default async function AreaTasaDevolucionPage() {
  const canManage = await canManageReturnRate();
  if (!canManage) redirect("/area");

  const records = await prisma.returnRateRecord.findMany({ orderBy: { month: "desc" } });

  return (
    <div>
      <TopLine eyebrow="Finanzas" title="Tasa de Devolución General" />
      <ReturnRatePanel records={records} />
    </div>
  );
}
