import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { readVisitor } from "@/lib/provedixVisitor";

// Quién es el visitante del chat de Michelle IA y cuál es su chat (2026-10-16,
// para adjuntos). Mismas reglas que /api/pvx/chat: registro completo (tienda y
// plataforma) y el chat tiene que ser suyo (mismo navegador o mismo registro).
export async function chatVisitor(req: NextRequest) {
  const { visitorId, leadId: anyLead } = await readVisitor(req);
  let leadId: string | null = null;
  if (anyLead) {
    const lead = await prisma.provedixLead.findUnique({ where: { id: anyLead }, select: { storeName: true, platform: true } });
    leadId = lead?.storeName?.trim() && lead.platform ? anyLead : null;
  }
  return { visitorId, leadId };
}

export async function ownChat(chatId: string | undefined | null, visitorId: string, leadId: string | null) {
  if (!chatId) return null;
  return prisma.provedixChat.findFirst({
    where: { id: chatId, OR: leadId ? [{ visitorId }, { leadId }] : [{ visitorId }] },
    select: { id: true },
  });
}

export async function ownChatIds(visitorId: string, leadId: string | null): Promise<string[]> {
  const rows = await prisma.provedixChat.findMany({
    where: { OR: leadId ? [{ visitorId }, { leadId }] : [{ visitorId }] },
    select: { id: true },
    take: 50,
    orderBy: { updatedAt: "desc" },
  });
  return rows.map((r) => r.id);
}
