import { prisma } from "@/lib/prisma";

// Confirmado 2026-08-25: código correlativo propio de "Reclamo posterior al
// cierre" (RPC-0001, RPC-0002...) — mismo patrón atómico que
// nextPurchaseRequestNumber/lastMerchandiseReentryNumber. Independiente del
// SC-XXX de la solicitud de origen porque el origen puede no ser exacto
// (mercadería mezclada, sin lote rastreable).
export async function nextLateClaimNumber(): Promise<number> {
  const updated = await prisma.platformSettings.update({
    where: { id: "singleton" },
    data: { lastLateClaimNumber: { increment: 1 } },
  });
  return updated.lastLateClaimNumber;
}

export function formatLateClaimCode(n: number): string {
  return `RPC-${String(n).padStart(4, "0")}`;
}
