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
// Confirmado 2026-09-11: pedido explícito del usuario — PERSONALIZADO NUNCA
// dispara esta celebración (ni el aviso de /api/ceo-bonuses al otorgarlo).
// Por ahora debe verse solo cuando se genera el rol de pago de su quincena,
// nada más — podría cambiar a futuro, pero hoy no.
export async function getUnseenCeoBonusesForViewer(viewerId: string): Promise<CeoBonusCelebration[]> {
  if (viewerId === "admin") return [];
  const [grants, seen] = await Promise.all([
    prisma.ceoBonusGrant.findMany({ where: { userId: viewerId, type: { not: "PERSONALIZADO" } }, orderBy: { grantedAt: "desc" } }),
    prisma.ceoBonusGrantSeen.findMany({ where: { viewerId } }),
  ]);
  const seenIds = new Set(seen.map((s) => s.grantId));
  return grants
    .filter((g) => !seenIds.has(g.id))
    .map((g) => ({
      grantId: g.id,
      type: g.type as "ADICIONAL" | "PRODUCTIVIDAD" | "MERITO",
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
