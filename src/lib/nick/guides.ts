import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { ecuadorDay } from "@/lib/fulfillmentGuides";
import type { NickGroup } from "@/lib/nick/sync";
import { NICK_ATTENTION, getNickAttention, getNickNoCorte, type NickAttentionKey } from "@/lib/nick/attention";

// Pantalla "Guías" de NICK: las guías de Dropi de los últimos 45 días con su
// estado, más las guías de los cortes que NICK no encontró en ninguna cuenta.
const WINDOW_DAYS = 45;
const PAGE_SIZE = 50;

export type NickGuidesFilter = {
  group?: NickGroup | "NO_ENCONTRADA" | null;
  // Etapa 2: una de las 5 listas de "Requiere atención".
  attention?: NickAttentionKey | null;
  account?: string | null;
  carrier?: string | null;
  day?: string | null; // día del corte (manifestDay)
  q?: string | null;
  page?: number;
};

export type NickGuideView = {
  guideNumber: string;
  dropiOrderId: string | null;
  account: string | null;
  carrier: string | null;
  city: string | null;
  status: string | null;
  statusGroup: string | null;
  rateType: string | null;
  // null = NICK no ha visto cambiar el estado (ya estaba así cuando la leyó por primera vez).
  statusSince: string | null;
  lastSeenAt: string | null;
  manifestDay: string | null;
  // Por qué está en "Requiere atención" (solo cuando se filtra por una de esas listas).
  reason: string | null;
};

export type NickGuidesResult = {
  counts: Record<string, number>;
  attentionCounts: Record<NickAttentionKey, number>;
  total: number;
  page: number;
  pageSize: number;
  rows: NickGuideView[];
  accounts: { id: string; name: string }[];
  carriers: string[];
  lastSyncAt: string | null;
  // false mientras alguna cuenta no termina su primera vuelta: "no encontradas" todavía no es confiable.
  firstSyncDone: boolean;
};

const norm = (g: string) => g.toUpperCase().replace(/\s+/g, "");
const isRocket = (codes: string[]) => codes.length > 0 && codes.every((c) => c.startsWith("R"));

// isAdmin: el admin ve además las estimaciones por fecha de orden (pedido del
// usuario 2026-10-16: "solo para ti", nadie más las ve).
export async function getNickGuides(f: NickGuidesFilter, opts: { isAdmin?: boolean } = {}): Promise<NickGuidesResult> {
  const since = new Date(Date.now() - WINDOW_DAYS * 864e5);
  const dayAgo = new Date(Date.now() - 864e5);
  const page = Math.max(1, f.page ?? 1);
  const q = f.q?.trim() || null;
  const accounts = await prisma.nickDropiAccount.findMany({ orderBy: { sortOrder: "asc" }, select: { id: true, name: true, lastSyncAt: true } });
  const accName = new Map(accounts.map((a) => [a.id, a.name]));
  const syncs = accounts.map((a) => a.lastSyncAt).filter((d): d is Date => !!d);
  // La más vieja de las 3: así "actualizado" nunca promete más de lo real.
  const lastSyncAt = syncs.length === accounts.length && syncs.length ? new Date(Math.min(...syncs.map((d) => d.getTime()))) : null;

  const dayGuides = f.day
    ? (await prisma.fulfillmentRequestGuide.findMany({ where: { manifestDay: f.day }, select: { guideNumber: true } })).map((g) => norm(g.guideNumber))
    : null;

  const where: Prisma.NickGuideStatusWhereInput = {
    AND: [
      { OR: [{ orderCreatedAt: { gte: since } }, { orderCreatedAt: null, firstSeenAt: { gte: since } }] },
      ...(q ? [{ OR: [{ guideNumber: { contains: q.toUpperCase() } }, { dropiOrderId: { contains: q } }] }] : []),
    ],
    ...(f.account ? { accountId: f.account } : {}),
    ...(f.carrier ? { carrier: f.carrier } : {}),
    ...(dayGuides ? { guideNumber: { in: dayGuides } } : {}),
  };
  const grouped = await prisma.nickGuideStatus.groupBy({ by: ["statusGroup"], where, _count: true });
  // Pedido del usuario 2026-10-16: "Requiere atención" lo ve SOLO el admin
  // mientras él hace sus pruebas. Excepción (2026-10-17): "Salió en Dropi sin
  // corte" también la ve quien tiene NICK (Daniel), para subir el PDF que faltó.
  const attention = opts.isAdmin
    ? await getNickAttention(new Date(), { estimates: true })
    : (Object.fromEntries(NICK_ATTENTION.map((a) => [a.key, new Map<string, string>()])) as Record<NickAttentionKey, Map<string, string>>);
  if (!opts.isAdmin) attention.SIN_CORTE = await getNickNoCorte();
  const attentionCounts = {} as Record<NickAttentionKey, number>;
  for (const a of NICK_ATTENTION) {
    const set = attention ? [...attention[a.key].keys()] : [];
    attentionCounts[a.key] = set.length ? await prisma.nickGuideStatus.count({ where: { AND: [where, { guideNumber: { in: set } }] } }) : 0;
  }
  const counts: Record<string, number> = {};
  for (const g of grouped) counts[g.statusGroup] = g._count;

  // No encontradas: guías de Dropi de los cortes (no Rocket), subidas hace
  // más de 1 día, que no aparecen en ninguna cuenta.
  const missingRaw = f.account
    ? []
    : await prisma.$queryRaw<{ guideNumber: string; manifestDay: string | null; carrier: string; destCity: string | null; codes: string[] }[]>`
        SELECT g."guideNumber", g."manifestDay", g."carrier", g."destCity", g."codes"
        FROM "FulfillmentRequestGuide" g
        LEFT JOIN "NickGuideStatus" n ON n."guideNumber" = upper(replace(g."guideNumber", ' ', ''))
        WHERE g."createdAt" >= ${since} AND g."createdAt" < ${dayAgo} AND n."guideNumber" IS NULL
        ${f.day ? Prisma.sql`AND g."manifestDay" = ${f.day}` : Prisma.empty}
        ${f.carrier ? Prisma.sql`AND g."carrier" = ${f.carrier}` : Prisma.empty}
        ORDER BY g."manifestDay" DESC NULLS LAST`;
  const firstSyncDone = !!lastSyncAt;
  const missing = (firstSyncDone ? missingRaw : []).filter((g) => !isRocket(g.codes) && (!q || norm(g.guideNumber).includes(q.toUpperCase())));
  counts.NO_ENCONTRADA = missing.length;

  let rows: NickGuideView[];
  let total: number;
  if (f.group === "NO_ENCONTRADA") {
    total = missing.length;
    rows = missing.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).map((g) => ({
      guideNumber: g.guideNumber,
      dropiOrderId: null,
      account: null,
      carrier: g.carrier,
      city: g.destCity,
      status: null,
      statusGroup: "NO_ENCONTRADA",
      rateType: null,
      statusSince: null,
      lastSeenAt: null,
      manifestDay: g.manifestDay,
      reason: null,
    }));
  } else {
    const attSet = f.attention && attention ? attention[f.attention] : null;
    const w: Prisma.NickGuideStatusWhereInput = {
      AND: [where, ...(f.group ? [{ statusGroup: f.group }] : []), ...(attSet ? [{ guideNumber: { in: [...attSet.keys()] } }] : [])],
    };
    total = await prisma.nickGuideStatus.count({ where: w });
    const list = await prisma.nickGuideStatus.findMany({
      where: w,
      orderBy: [{ orderCreatedAt: "desc" }, { firstSeenAt: "desc" }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    });
    const corte = await prisma.fulfillmentRequestGuide.findMany({
      where: { guideNumber: { in: list.map((g) => g.guideNumber) } },
      select: { guideNumber: true, manifestDay: true },
    });
    const corteDay = new Map(corte.map((g) => [norm(g.guideNumber), g.manifestDay]));
    rows = list.map((g) => ({
      guideNumber: g.guideNumber,
      dropiOrderId: g.dropiOrderId,
      account: accName.get(g.accountId) ?? null,
      carrier: g.carrier,
      city: g.city,
      status: g.status,
      statusGroup: g.statusGroup,
      rateType: g.rateType,
      statusSince: g.statusSince.getTime() > g.firstSeenAt.getTime() ? g.statusSince.toISOString() : null,
      lastSeenAt: g.lastSeenAt.toISOString(),
      // Día del corte; si la guía no vino en un corte, el día de la orden.
      manifestDay: corteDay.get(g.guideNumber) ?? (g.orderCreatedAt ? ecuadorDay(g.orderCreatedAt) : null),
      reason: attSet?.get(g.guideNumber) ?? null,
    }));
  }

  const carriers = (await prisma.nickGuideStatus.findMany({ where: { carrier: { not: null } }, distinct: ["carrier"], select: { carrier: true } }))
    .map((c) => c.carrier!)
    .sort();

  return { counts, attentionCounts, total, page, pageSize: PAGE_SIZE, rows, accounts: accounts.map((a) => ({ id: a.id, name: a.name })), carriers, lastSyncAt: lastSyncAt?.toISOString() ?? null, firstSyncDone };
}
