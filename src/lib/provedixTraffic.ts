import { prisma } from "@/lib/prisma";
import { notifyOwner } from "@/lib/notifications";
import { chatSuspicion } from "@/lib/provedixSuspicion";

// Etapa 4 de provedix.com (2026-10-12, decisiones del usuario): tráfico y
// cartera de dropshippers se ven SOLO en la sección Provedix del admin, sin
// resumen diario/semanal; el único aviso es cuando hay un pico de visitas.
// Todo sale de ProvedixEvent/ProvedixLead, que la página ya guarda desde la
// etapa 3 — nada nuevo en la base.

// Ecuador no cambia de hora: siempre UTC-5.
const EC_OFFSET_MS = 5 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const CHART_DAYS = 14;

function ecuadorDayStart(daysAgo: number): Date {
  const ec = new Date(Date.now() - EC_OFFSET_MS);
  const start = Date.UTC(ec.getUTCFullYear(), ec.getUTCMonth(), ec.getUTCDate()) + EC_OFFSET_MS;
  return new Date(start - daysAgo * DAY_MS);
}

async function distinctVisitors(since: Date): Promise<number> {
  const rows = await prisma.$queryRaw<{ n: bigint }[]>`
    SELECT COUNT(DISTINCT "visitorId") AS n FROM "ProvedixEvent" WHERE type = 'visit' AND "createdAt" >= ${since}`;
  return Number(rows[0]?.n ?? 0);
}

// Nombre del producto por su ID de Dropi: primero el resumen público, si no
// el catálogo de DAFLOW.
async function productNames(codes: string[]): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  if (codes.length === 0) return names;
  const snap = await prisma.provedixSnapshot.findFirst({ orderBy: { day: "desc" }, select: { data: true } });
  for (const p of ((snap?.data as { products?: { code: string; name: string }[] } | null)?.products ?? [])) names.set(p.code, p.name);
  const missing = codes.filter((c) => !names.has(c));
  if (missing.length) {
    const items = await prisma.purchaseCatalogItem.findMany({ where: { justCode: { in: missing } }, select: { justCode: true, name: true } });
    for (const i of items) if (i.justCode) names.set(i.justCode, i.name);
  }
  return names;
}

export type ProvedixTraffic = {
  visitors: { today: number; last7: number; last30: number };
  leads: { today: number; last7: number; last30: number; total: number };
  daily: { day: string; visitors: number; leads: number }[];
  topSearches: { label: string; count: number }[];
  topProducts: { code: string; name: string; count: number }[];
  // Clics en "Consultar con el asesor" (WhatsApp) por producto — para ver la
  // demanda, sobre todo de lo que está sin stock (pedido 2026-10-12).
  topWhatsapp: { code: string; name: string; count: number }[];
};

export async function getProvedixTraffic(): Promise<ProvedixTraffic> {
  const today = ecuadorDayStart(0);
  const d7 = ecuadorDayStart(6);
  const d30 = ecuadorDayStart(29);
  const chartFrom = ecuadorDayStart(CHART_DAYS - 1);

  const [vToday, v7, v30, lToday, l7, l30, lTotal, dailyVisitors, dailyLeads, searches, products, whatsapp] = await Promise.all([
    distinctVisitors(today),
    distinctVisitors(d7),
    distinctVisitors(d30),
    prisma.provedixLead.count({ where: { createdAt: { gte: today } } }),
    prisma.provedixLead.count({ where: { createdAt: { gte: d7 } } }),
    prisma.provedixLead.count({ where: { createdAt: { gte: d30 } } }),
    prisma.provedixLead.count(),
    prisma.$queryRaw<{ day: string; n: bigint }[]>`
      SELECT to_char("createdAt" - interval '5 hours', 'YYYY-MM-DD') AS day, COUNT(DISTINCT "visitorId") AS n
      FROM "ProvedixEvent" WHERE type = 'visit' AND "createdAt" >= ${chartFrom} GROUP BY 1`,
    prisma.$queryRaw<{ day: string; n: bigint }[]>`
      SELECT to_char("createdAt" - interval '5 hours', 'YYYY-MM-DD') AS day, COUNT(*) AS n
      FROM "ProvedixLead" WHERE "createdAt" >= ${chartFrom} GROUP BY 1`,
    // Mismo texto con distinta mayúscula o espacios cuenta como una búsqueda.
    prisma.$queryRaw<{ label: string; n: bigint }[]>`
      SELECT lower(trim(query)) AS label, COUNT(*) AS n FROM "ProvedixEvent"
      WHERE type = 'search' AND query IS NOT NULL AND trim(query) <> '' AND "createdAt" >= ${d30}
      GROUP BY 1 ORDER BY 2 DESC LIMIT 10`,
    prisma.provedixEvent.groupBy({
      by: ["productCode"],
      where: { type: "product", productCode: { not: null }, createdAt: { gte: d30 } },
      _count: { _all: true },
      orderBy: { _count: { productCode: "desc" } },
      take: 10,
    }),
    prisma.provedixEvent.groupBy({
      by: ["productCode"],
      where: { type: "whatsapp", productCode: { not: null }, createdAt: { gte: d30 } },
      _count: { _all: true },
      orderBy: { _count: { productCode: "desc" } },
      take: 10,
    }),
  ]);

  const names = await productNames([...products, ...whatsapp].map((p) => p.productCode!));
  const vByDay = new Map(dailyVisitors.map((r) => [r.day, Number(r.n)]));
  const lByDay = new Map(dailyLeads.map((r) => [r.day, Number(r.n)]));
  const daily = Array.from({ length: CHART_DAYS }, (_, i) => {
    const day = new Date(ecuadorDayStart(CHART_DAYS - 1 - i).getTime() - EC_OFFSET_MS).toISOString().slice(0, 10);
    return { day, visitors: vByDay.get(day) ?? 0, leads: lByDay.get(day) ?? 0 };
  });

  return {
    visitors: { today: vToday, last7: v7, last30: v30 },
    leads: { today: lToday, last7: l7, last30: l30, total: lTotal },
    daily,
    topSearches: searches.map((s) => ({ label: s.label, count: Number(s.n) })),
    topProducts: products.map((p) => ({ code: p.productCode!, name: names.get(p.productCode!) ?? p.productCode!, count: p._count._all })),
    topWhatsapp: whatsapp.map((p) => ({ code: p.productCode!, name: names.get(p.productCode!) ?? p.productCode!, count: p._count._all })),
  };
}

export type ProvedixLeadRow = {
  id: string;
  name: string;
  whatsapp: string;
  // Desde 2026-10-14 (null en registros anteriores).
  storeName: string | null;
  platform: string | null;
  platformEmail: string | null;
  createdAt: string;
  lastSeenAt: string;
  visits: number;
  searches: number;
  products: number;
};

export async function getProvedixLeads(): Promise<ProvedixLeadRow[]> {
  const [leads, counts] = await Promise.all([
    prisma.provedixLead.findMany({ orderBy: { lastSeenAt: "desc" } }),
    prisma.provedixEvent.groupBy({ by: ["leadId", "type"], where: { leadId: { not: null }, type: { in: ["search", "product"] } }, _count: { _all: true } }),
  ]);
  const byLead = new Map<string, { searches: number; products: number }>();
  for (const c of counts) {
    const e = byLead.get(c.leadId!) ?? { searches: 0, products: 0 };
    if (c.type === "search") e.searches = c._count._all;
    else e.products = c._count._all;
    byLead.set(c.leadId!, e);
  }
  return leads.map((l) => ({
    id: l.id,
    name: l.name,
    whatsapp: l.whatsapp,
    storeName: l.storeName,
    platform: l.platform,
    platformEmail: l.platformEmail,
    createdAt: l.createdAt.toISOString(),
    lastSeenAt: l.lastSeenAt.toISOString(),
    visits: l.visits,
    searches: byLead.get(l.id)?.searches ?? 0,
    products: byLead.get(l.id)?.products ?? 0,
  }));
}

export type ProvedixLeadActivity = {
  searches: { label: string; count: number }[];
  products: { code: string; name: string; count: number }[];
  recent: { type: "visit" | "search" | "product" | "whatsapp"; text: string; at: string }[];
};

// Historial de un dropshipper: lo que más buscó, los productos que más abrió
// y lo último que hizo en la página.
export async function getProvedixLeadActivity(leadId: string): Promise<ProvedixLeadActivity> {
  const events = await prisma.provedixEvent.findMany({
    where: { leadId, type: { in: ["visit", "search", "product", "whatsapp"] } },
    orderBy: { createdAt: "desc" },
    take: 500,
    select: { type: true, query: true, productCode: true, createdAt: true },
  });
  const names = await productNames([...new Set(events.map((e) => e.productCode).filter((c): c is string => !!c))]);
  const searches = new Map<string, number>();
  const products = new Map<string, number>();
  for (const e of events) {
    if (e.type === "search" && e.query?.trim()) searches.set(e.query.trim().toLowerCase(), (searches.get(e.query.trim().toLowerCase()) ?? 0) + 1);
    if (e.type === "product" && e.productCode) products.set(e.productCode, (products.get(e.productCode) ?? 0) + 1);
  }
  const top = <T,>(m: Map<string, number>, f: (k: string, n: number) => T) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([k, n]) => f(k, n));
  return {
    searches: top(searches, (label, count) => ({ label, count })),
    products: top(products, (code, count) => ({ code, name: names.get(code) ?? code, count })),
    recent: events.slice(0, 30).map((e) => ({
      type: e.type as "visit" | "search" | "product" | "whatsapp",
      text:
        e.type === "search"
          ? `Buscó "${e.query ?? ""}"`
          : e.type === "product"
            ? `Abrió ${names.get(e.productCode ?? "") ?? e.productCode}`
            : e.type === "whatsapp"
              ? `Escribió al asesor por ${names.get(e.productCode ?? "") ?? e.productCode}`
              : "Entró a la página",
      at: e.createdAt.toISOString(),
    })),
  };
}

// Aviso de pico de visitas (pedido del usuario 2026-10-12): si en la última
// hora entran muchas más personas que lo normal, le llega un aviso al admin
// al momento. "Lo normal" = promedio por hora de los 7 días anteriores. Para
// no repetir el aviso se guarda una fila type "alert" y no se vuelve a
// avisar en 3 horas. Corre después de responder cada visita (after()), así
// que no hace más lenta la página.
const SPIKE_MIN_VISITORS = 20;
const SPIKE_FACTOR = 3;
const SPIKE_COOLDOWN_MS = 3 * HOUR_MS;

export async function checkProvedixSpike(): Promise<void> {
  const now = Date.now();
  const lastHour = await distinctVisitors(new Date(now - HOUR_MS));
  if (lastHour < SPIKE_MIN_VISITORS) return;

  const recentAlert = await prisma.provedixEvent.findFirst({ where: { type: "alert", createdAt: { gte: new Date(now - SPIKE_COOLDOWN_MS) } }, select: { id: true } });
  if (recentAlert) return;

  const rows = await prisma.$queryRaw<{ n: bigint }[]>`
    SELECT COUNT(DISTINCT ("visitorId", date_trunc('hour', "createdAt"))) AS n FROM "ProvedixEvent"
    WHERE type = 'visit' AND "createdAt" >= ${new Date(now - 7 * DAY_MS - HOUR_MS)} AND "createdAt" < ${new Date(now - HOUR_MS)}`;
  const normal = Number(rows[0]?.n ?? 0) / (7 * 24);
  if (lastHour < normal * SPIKE_FACTOR) return;

  await prisma.provedixEvent.create({ data: { visitorId: "system", type: "alert", query: `${lastHour} en 1 h` } });
  const normalLabel = normal < 1 ? "menos de 1" : `unas ${Math.round(normal)}`;
  await notifyOwner("admin", {
    title: "Provedix: pico de visitas",
    body: `${lastHour} personas entraron a provedix.com en la última hora (lo normal es ${normalLabel} por hora).`,
    url: "/admin/provedix",
  });
}

// Conversaciones con Michelle, la asistente virtual (2026-10-15) — SOLO el admin.
export type ProvedixChatRow = {
  id: string;
  who: string;
  whatsapp: string | null;
  messages: number;
  lastQuestion: string | null;
  blocked: boolean;
  // Sospecha (provedixSuspicion.ts): motivos y si falta que el admin la revise.
  suspicious: boolean;
  reasons: string[];
  pendingReview: boolean;
  updatedAt: string;
};

export async function getProvedixChats(): Promise<ProvedixChatRow[]> {
  const chats = await prisma.provedixChat.findMany({
    orderBy: { updatedAt: "desc" },
    take: 60,
    select: {
      id: true,
      updatedAt: true,
      lead: { select: { name: true, whatsapp: true } },
      _count: { select: { messages: { where: { role: { in: ["user", "assistant"] } } } } },
      messages: { where: { role: { in: ["user", "blocked", "blocked_24h", "unblocked", "flag", "guide_fail", "reviewed"] } }, orderBy: { createdAt: "desc" }, select: { role: true, content: true, createdAt: true } },
    },
  });
  return chats
    .filter((c) => c._count.messages > 0)
    .map((c) => {
      const s = chatSuspicion(c.messages);
      return {
        id: c.id,
        who: c.lead?.name ?? "Visitante sin registro",
        whatsapp: c.lead?.whatsapp ?? null,
        messages: c._count.messages,
        lastQuestion: c.messages.find((m) => m.role === "user")?.content ?? null,
        blocked: c.messages.some((m) => m.role === "blocked" || (m.role === "blocked_24h" && m.createdAt.getTime() > Date.now() - 86_400_000)),
        suspicious: s.suspicious,
        reasons: s.reasons,
        pendingReview: s.pending,
        updatedAt: c.updatedAt.toISOString(),
      };
    });
}

export async function getProvedixChatMessages(chatId: string): Promise<{ role: string; content: string; at: string }[]> {
  const rows = await prisma.provedixChatMessage.findMany({ where: { chatId }, orderBy: { createdAt: "asc" }, take: 300, select: { role: true, content: true, createdAt: true } });
  return rows.map((m) => ({ role: m.role, content: m.content, at: m.createdAt.toISOString() }));
}

// Desbloquear a quien Michelle cerró el chat (el admin decide). Quita el
// bloqueo de esa persona en todas sus conversaciones (mismo navegador o
// registro); queda como "unblocked" para no perder el historial.
export async function unblockProvedixChat(chatId: string): Promise<void> {
  const chat = await prisma.provedixChat.findUnique({ where: { id: chatId }, select: { visitorId: true, leadId: true } });
  if (!chat) return;
  await prisma.provedixChatMessage.updateMany({
    where: { role: { in: ["blocked", "blocked_24h"] }, chat: chat.leadId ? { OR: [{ visitorId: chat.visitorId }, { leadId: chat.leadId }] } : { visitorId: chat.visitorId } },
    data: { role: "unblocked", content: "El admin desbloqueó a esta persona." },
  });
}

// El admin leyó una conversación sospechosa: deja de salir en su Inicio
// (vuelve a salir si pasa algo sospechoso nuevo).
export async function markProvedixChatReviewed(chatId: string): Promise<void> {
  await prisma.provedixChatMessage.create({ data: { chatId, role: "reviewed", content: "El admin revisó esta conversación." } });
}
