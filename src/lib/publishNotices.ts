import { prisma } from "@/lib/prisma";
import { notifyOwner } from "@/lib/notifications";
import { addBusinessHours } from "@/lib/businessHours";
import { getIdDeadlineItems, ID_DEADLINE_HOURS } from "@/lib/handoffLocks";

// Pedido de Jariel 2026-10-15 (aprobado por el usuario): avisos a la asesora
// B2B (quien tiene canPublishMarketProduct, hoy Michelle) para crear el ID en
// Dropi de lo que Bryan aprueba:
// 1) en el momento en que Bryan aprueba;
// 2) a los 30 minutos laborables si todavía no puso el ID (sin penalización);
// 3) cuando la compra del producto ya está pagada y sigue sin ID — avisa que
//    en 6 horas laborables DAFLOW se bloquea (el bloqueo vive en handoffLocks.ts).
// El 2 y el 3 no tienen un momento propio en que "pase" algo, así que se
// revisan cada minuto aprovechando la campanita de quien tenga DAFLOW abierto
// (ver /api/notifications). No se repiten: se busca el aviso ya guardado.
export const PUBLISH_TAB_URL = "/area/workspace?tab=analisis-mercado&ptab=publicar";
const APPROVED_TITLE = "Producto aprobado: crea el ID en Dropi";
const REMINDER_TITLE = "Recordatorio: crea el ID en Dropi";
const PAID_TITLE = "Ya hay orden de compra: falta el ID en Dropi";
const REMINDER_BUSINESS_HOURS = 0.5;
// Lo aprobado/pagado antes de subir esto no dispara avisos 2 y 3 de golpe.
const NOTICES_START = new Date("2026-10-15T22:00:00Z");

async function publisherIds(): Promise<string[]> {
  const users = await prisma.user.findMany({ where: { canPublishMarketProduct: true, isActive: true }, select: { id: true } });
  return users.map((u) => u.id);
}

// Pedido de Michelle (asesora B2B) 2026-10-15, caso AM-0052: el aviso dice
// si el ID lleva variantes, para no tener que abrir DAFLOW para saberlo.
export function variantsLine(hasVariants: boolean | null | undefined, variantNotes: string | null | undefined): string {
  if (hasVariants == null) return "";
  if (!hasVariants) return " Sin variantes.";
  return ` Con variantes: ${(variantNotes ?? "").trim() || "ver notas en DAFLOW"}.`;
}

export async function notifyPublishersOfApproval(code: string, productName: string, variants?: { hasVariants: boolean | null; variantNotes: string | null }): Promise<void> {
  const ids = await publisherIds();
  const extra = variants ? variantsLine(variants.hasVariants, variants.variantNotes) : "";
  await Promise.all(
    ids.map((id) =>
      notifyOwner(id, {
        title: APPROVED_TITLE,
        body: `${code} ${productName} — Bryan lo aprobó. Créalo en Dropi y pon el ID en DAFLOW.${extra}`,
        url: PUBLISH_TAB_URL,
      }).catch(() => null)
    )
  );
}

// Con el ID ya puesto, los avisos de "crea el ID" de ese producto dejan de
// salir como pendientes en la campanita.
export async function markPublishNoticesDone(code: string): Promise<void> {
  await prisma.notification.updateMany({
    where: { title: { in: [APPROVED_TITLE, REMINDER_TITLE, PAID_TITLE] }, body: { startsWith: `${code} ` }, readAt: null },
    data: { readAt: new Date() },
  });
}

let lastRun = 0;

export async function sendDuePublishNotices(now = new Date()): Promise<void> {
  if (now.getTime() - lastRun < 60_000) return;
  lastRun = now.getTime();

  const [pending, paidItems] = await Promise.all([
    prisma.marketProductProposal.findMany({
      where: { status: "APPROVED", publishedAt: null, reviewedAt: { gte: NOTICES_START, lte: new Date(now.getTime() - 30 * 60_000) } },
      select: { id: true, code: true, productName: true, reviewedAt: true },
    }),
    getIdDeadlineItems(now),
  ]);
  const dueReminders = pending.filter((p) => addBusinessHours(p.reviewedAt!, REMINDER_BUSINESS_HOURS) <= now);
  const duePaid = paidItems.filter((i) => new Date(i.since) >= NOTICES_START);
  if (dueReminders.length === 0 && duePaid.length === 0) return;

  const codeById = new Map(
    (await prisma.marketProductProposal.findMany({ where: { id: { in: duePaid.map((i) => i.proposalId) } }, select: { id: true, code: true } })).map((p) => [p.id, p.code])
  );
  const ids = await publisherIds();
  const already = await prisma.notification.findMany({
    where: { ownerId: { in: ids }, title: { in: [REMINDER_TITLE, PAID_TITLE] }, createdAt: { gte: NOTICES_START } },
    select: { ownerId: true, title: true, body: true },
  });
  const sent = (ownerId: string, title: string, code: string) => already.some((n) => n.ownerId === ownerId && n.title === title && n.body.startsWith(`${code} `));

  const jobs: Promise<unknown>[] = [];
  for (const ownerId of ids) {
    for (const p of dueReminders) {
      if (sent(ownerId, REMINDER_TITLE, p.code)) continue;
      jobs.push(
        notifyOwner(ownerId, {
          title: REMINDER_TITLE,
          body: `${p.code} ${p.productName} — Bryan lo aprobó hace un rato y todavía no tiene ID. Créalo en Dropi y ponlo en DAFLOW.`,
          url: PUBLISH_TAB_URL,
        }).catch(() => null)
      );
    }
    for (const i of duePaid) {
      const code = codeById.get(i.proposalId);
      if (!code || sent(ownerId, PAID_TITLE, code)) continue;
      jobs.push(
        notifyOwner(ownerId, {
          title: PAID_TITLE,
          body: `${code} ${i.name} — Ya hay una orden de compra de este producto. ¿Ya creaste el ID en Dropi? No te olvides de cargarlo en DAFLOW: si no lo haces, tu cuenta de DAFLOW tendrá un pequeño bloqueo en ${ID_DEADLINE_HOURS} horas laborables.`,
          url: PUBLISH_TAB_URL,
        }).catch(() => null)
      );
    }
  }
  await Promise.all(jobs);
}
