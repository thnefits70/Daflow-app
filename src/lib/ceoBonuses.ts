import { prisma } from "@/lib/prisma";
import { pickCeoBonusMessage, CEO_BONUS_MESSAGE_SIGNATURE } from "@/lib/ceoBonusMessages";
import { CEO_BONUS_LABELS } from "@/lib/commissionTiers";

export type CeoBonusCelebration = {
  grantId: string;
  type: "ADICIONAL" | "PRODUCTIVIDAD" | "MERITO";
  label: string;
  note: string | null;
  message: string;
  signature: string;
};

// Confirmado 2026-08-14: confidencial — solo el propio destinatario ve su
// celebración. El admin nunca recibe un bono de sí mismo, así que su
// viewerId ("admin") nunca tiene nada pendiente acá.
export async function getUnseenCeoBonusesForViewer(viewerId: string): Promise<CeoBonusCelebration[]> {
  if (viewerId === "admin") return [];
  const [grants, seen] = await Promise.all([
    prisma.ceoBonusGrant.findMany({ where: { userId: viewerId }, orderBy: { grantedAt: "desc" } }),
    prisma.ceoBonusGrantSeen.findMany({ where: { viewerId } }),
  ]);
  const seenIds = new Set(seen.map((s) => s.grantId));
  return grants
    .filter((g) => !seenIds.has(g.id))
    .map((g) => ({
      grantId: g.id,
      type: g.type,
      label: CEO_BONUS_LABELS[g.type],
      note: g.note,
      message: pickCeoBonusMessage(viewerId, g.id),
      signature: CEO_BONUS_MESSAGE_SIGNATURE,
    }));
}

export async function markCeoBonusSeen(viewerId: string, grantId: string) {
  await prisma.ceoBonusGrantSeen.upsert({
    where: { viewerId_grantId: { viewerId, grantId } },
    update: {},
    create: { viewerId, grantId },
  });
}
