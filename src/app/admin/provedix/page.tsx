import { getProvedixOverview } from "@/lib/provedixAdmin";
import { getLatestProvedixSnapshot } from "@/lib/provedixSnapshot";
import { getProvedixChats, getProvedixLeads, getProvedixTraffic } from "@/lib/provedixTraffic";
import { ProvedixPanel } from "@/components/provedix/ProvedixPanel";
import { michelleWeeklyStats } from "@/lib/provedixCases";
import { prisma } from "@/lib/prisma";

// AdminLayout ya exige role === "admin" para todo /admin/* — no hace falta
// otro guard aquí (pedido del usuario 2026-10-10: solo él ve esta sección).
export default async function ProvedixPage() {
  const [overview, snapshot, traffic, leads, chats, michelleStats, openCases] = await Promise.all([
    getProvedixOverview(),
    getLatestProvedixSnapshot(),
    getProvedixTraffic(),
    getProvedixLeads(),
    getProvedixChats(),
    michelleWeeklyStats(),
    prisma.provedixCase.count({ where: { status: "ABIERTO" } }),
  ]);
  return <ProvedixPanel overview={overview} snapshot={snapshot} traffic={traffic} leads={leads} chats={chats} michelleStats={michelleStats} openCases={openCases} />;
}
