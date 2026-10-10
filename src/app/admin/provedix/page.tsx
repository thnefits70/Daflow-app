import { getProvedixOverview } from "@/lib/provedixAdmin";
import { getLatestProvedixSnapshot } from "@/lib/provedixSnapshot";
import { ProvedixPanel } from "@/components/provedix/ProvedixPanel";

// AdminLayout ya exige role === "admin" para todo /admin/* — no hace falta
// otro guard aquí (pedido del usuario 2026-10-10: solo él ve esta sección).
export default async function ProvedixPage() {
  const [overview, snapshot] = await Promise.all([getProvedixOverview(), getLatestProvedixSnapshot()]);
  return <ProvedixPanel overview={overview} snapshot={snapshot} />;
}
