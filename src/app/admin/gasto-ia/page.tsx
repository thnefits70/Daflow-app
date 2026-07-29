import { getAiSpendOverview } from "@/lib/aiUsage";
import { AiSpendPanel } from "@/components/dashboard/AiSpendPanel";

// AdminLayout ya exige role === "admin" para todo /admin/* — no hace falta
// otro guard aquí.
export default async function AiSpendPage() {
  const overview = await getAiSpendOverview();
  return <AiSpendPanel overview={overview} />;
}
