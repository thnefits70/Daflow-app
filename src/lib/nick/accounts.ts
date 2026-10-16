import { prisma } from "@/lib/prisma";

export type NickAccountView = {
  id: string;
  name: string;
  status: "conectada" | "sin_conectar" | "por_reconectar";
  connectedAt: string | null;
  connectedByName: string | null;
  dropiIdentity: string | null;
  lastReadAt: string | null;
  lastError: string | null;
};

// Lo que ve la pantalla de NICK de cada cuenta — nunca el permiso en sí.
export async function getNickAccounts(): Promise<NickAccountView[]> {
  const rows = await prisma.nickDropiAccount.findMany({
    orderBy: { sortOrder: "asc" },
    include: { connectedBy: { select: { name: true } } },
  });
  return rows.map((a) => ({
    id: a.id,
    name: a.name,
    status: !a.accessTokenEnc ? "sin_conectar" : a.needsReconnect ? "por_reconectar" : "conectada",
    connectedAt: a.connectedAt?.toISOString() ?? null,
    connectedByName: a.connectedAt ? (a.connectedBy?.name ?? "Administrador") : null,
    dropiIdentity: a.dropiIdentity,
    lastReadAt: a.lastReadAt?.toISOString() ?? null,
    lastError: a.lastError,
  }));
}
