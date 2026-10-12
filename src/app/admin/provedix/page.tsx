import { getProvedixOverview } from "@/lib/provedixAdmin";
import { getLatestProvedixSnapshot } from "@/lib/provedixSnapshot";
import { getProvedixLeads, getProvedixTraffic } from "@/lib/provedixTraffic";
import { ProvedixPanel } from "@/components/provedix/ProvedixPanel";

// AdminLayout ya exige role === "admin" para todo /admin/* — no hace falta
// otro guard aquí (pedido del usuario 2026-10-10: solo él ve esta sección).
export default async function ProvedixPage() {
  const [overview, snapshot, traffic, leads] = await Promise.all([getProvedixOverview(), getLatestProvedixSnapshot(), getProvedixTraffic(), getProvedixLeads()]);
  return <ProvedixPanel overview={overview} snapshot={snapshot} traffic={traffic} leads={leads} />;
}
