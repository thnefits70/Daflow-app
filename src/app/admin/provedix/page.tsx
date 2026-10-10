import { getProvedixOverview } from "@/lib/provedixAdmin";
import { ProvedixPanel } from "@/components/provedix/ProvedixPanel";

// AdminLayout ya exige role === "admin" para todo /admin/* — no hace falta
// otro guard aquí (pedido del usuario 2026-10-10: solo él ve esta sección).
export default async function ProvedixPage() {
  const overview = await getProvedixOverview();
  return <ProvedixPanel overview={overview} />;
}
