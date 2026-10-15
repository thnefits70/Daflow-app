import { prisma } from "@/lib/prisma";
import { addBusinessHours } from "@/lib/businessHours";

// Pedido del usuario 2026-10-15 (caso Set billetera / Intercomunicador: la
// mercadería llegaba y no entraba a INVESTOCK porque el ID madre y la
// liberación al Kardex se quedaban esperando días):
// - La asesora B2B (quien tiene canPublishMarketProduct, hoy Michelle) tiene
//   6 horas laborables desde que se PAGA la compra para crear el ID madre en
//   Dropi y ponerlo en DAFLOW.
// - Bryan (líder de Análisis de Mercado) tiene 3 horas laborables desde que
//   el producto ya tiene ID Y la mercadería ya está en bodega para liberarla
//   al Kardex con un clic.
// Pasado el plazo, DAFLOW se le bloquea con una capa encima de la pantalla
// (no se pierde lo que estaba haciendo) y la única opción es resolver eso.
// Horas laborables = horario único de la empresa (businessHours.ts).
export const ID_DEADLINE_HOURS = 6;
export const RELEASE_DEADLINE_HOURS = 3;

// Decisión del usuario 2026-10-15: lo que ya estaba atrasado al subir esto
// empieza a contar desde ese momento, para que nadie quede bloqueado de golpe.
export const HANDOFF_CLOCK_START = new Date("2026-10-15T16:00:00Z");

export type HandoffItem = { proposalId: string; name: string; since: string; deadline: string; overdue: boolean; units: number };

function later(a: Date, b: Date): Date {
  return a > b ? a : b;
}

function toItem(proposalId: string, name: string, since: Date, hours: number, units: number, now: Date): HandoffItem {
  const deadline = addBusinessHours(later(since, HANDOFF_CLOCK_START), hours);
  return { proposalId, name, since: since.toISOString(), deadline: deadline.toISOString(), overdue: now >= deadline, units };
}

// Productos nuevos aprobados, con compra ya pagada, que todavía no tienen ID madre.
export async function getIdDeadlineItems(now = new Date()): Promise<HandoffItem[]> {
  const proposals = await prisma.marketProductProposal.findMany({
    where: { status: "APPROVED", publishedAt: null, rocketOnly: false, catalogItemId: { not: null }, catalogItem: { awaitingDropiId: true } },
    select: {
      id: true,
      productName: true,
      catalogItem: {
        select: { requests: { where: { paidAt: { not: null }, status: { not: "REJECTED" } }, select: { paidAt: true, quantity: true } } },
      },
    },
  });
  const items: HandoffItem[] = [];
  for (const p of proposals) {
    const paid = p.catalogItem?.requests ?? [];
    if (paid.length === 0) continue;
    const firstPaid = paid.reduce((m, r) => (r.paidAt! < m ? r.paidAt! : m), paid[0].paidAt!);
    items.push(toItem(p.id, p.productName, firstPaid, ID_DEADLINE_HOURS, paid.reduce((s, r) => s + r.quantity, 0), now));
  }
  return items.sort((a, b) => a.deadline.localeCompare(b.deadline));
}

// Con ID madre y mercadería ya aprobada en bodega, esperando que Bryan la libere.
export async function getReleaseDeadlineItems(now = new Date()): Promise<HandoffItem[]> {
  const proposals = await prisma.marketProductProposal.findMany({
    where: { publishedAt: { not: null }, dropiProductId: { not: null }, kardexReleasedAt: null, catalogItem: { awaitingDropiId: true } },
    select: {
      id: true,
      productName: true,
      publishedAt: true,
      catalogItem: {
        select: {
          requests: {
            where: { status: "RECEIVED", receipt: { approvedAt: { not: null }, stockKardexEntry: null } },
            select: { receipt: { select: { approvedAt: true, receivedQuantity: true } } },
          },
        },
      },
    },
  });
  const items: HandoffItem[] = [];
  for (const p of proposals) {
    const receipts = (p.catalogItem?.requests ?? []).map((r) => r.receipt!).filter(Boolean);
    if (receipts.length === 0) continue;
    const firstArrival = receipts.reduce((m, r) => (r.approvedAt! < m ? r.approvedAt! : m), receipts[0].approvedAt!);
    items.push(toItem(p.id, p.productName, later(firstArrival, p.publishedAt!), RELEASE_DEADLINE_HOURS, receipts.reduce((s, r) => s + r.receivedQuantity, 0), now));
  }
  return items.sort((a, b) => a.deadline.localeCompare(b.deadline));
}

export type HandoffLock = { kind: "id" | "release"; items: HandoffItem[] };

// El bloqueo de esta persona (null = puede trabajar normal). El admin nunca
// se bloquea. Muestra TODOS sus pendientes (no solo los vencidos) para que
// los resuelva de una vez.
export async function getHandoffLock(userId: string): Promise<HandoffLock | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { isActive: true, canPublishMarketProduct: true, isLeader: true, leadsDept: { select: { code: true } } },
  });
  if (!user?.isActive) return null;
  if (user.canPublishMarketProduct) {
    const items = await getIdDeadlineItems();
    if (items.some((i) => i.overdue)) return { kind: "id", items };
  }
  if (user.isLeader && user.leadsDept?.code === "MKT") {
    const items = await getReleaseDeadlineItems();
    if (items.some((i) => i.overdue)) return { kind: "release", items };
  }
  return null;
}

// Pendiente en Inicio de la asesora B2B: el ID madre con la hora en que se bloquea.
export async function getIdDeadlinePendingItem(href: string): Promise<{ type: string; icon: string; label: string; meta: string; overdue: boolean; href: string } | null> {
  const items = await getIdDeadlineItems();
  if (items.length === 0) return null;
  const first = items[0];
  return {
    type: "analisis_mercado_id_plazo",
    icon: "⏰",
    label: "Poner el ID madre de Dropi (compra ya pagada)",
    meta: `${items.length === 1 ? first.name : `${items.length} productos`} · ${timeLeftText(first.deadline)}`,
    overdue: items.some((i) => i.overdue),
    href,
  };
}

// "se bloquea jue 15:30" / "venció" — para Inicio (hora de Ecuador).
export function timeLeftText(deadline: string, now = new Date()): string {
  if (new Date(deadline) <= now) return "venció: DAFLOW queda bloqueado hasta resolverlo";
  const when = new Date(deadline).toLocaleString("es-EC", { timeZone: "America/Guayaquil", weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false });
  return `se bloquea ${when}`;
}
