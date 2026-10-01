import { prisma } from "@/lib/prisma";
import { senderMatches } from "@/lib/dropiGuidesPdf";

// ---------------- Seguimiento de tiendas (Análisis de Mercado) ----------------
// Confirmado con el usuario 2026-10-01: todo ID de Importadora Shanghai tiene
// que estar vinculado a la tienda que lo vende (hoy solo Alonfe, que en la
// etiqueta de Dropi sale como remitente "GUSTAVO URIBE"). Con eso Yair y Bryan
// ven la tendencia de pedidos de cada producto y le recuerdan a la tienda
// hacer pauta cuando uno se estanca. Solo lectura para todos; el único cambio
// posible es el vínculo ID ↔ tienda, y lo hace Yair (canLinkStoreProducts).
//
// Pedidos = guías (FulfillmentRequestGuide.codes) que traen ese ID, por el día
// del manifiesto. Las guías anteriores al 2026-09-28 no guardaban sus códigos,
// así que la historia empieza con los manifiestos del 21/09 en adelante.

const EC_OFFSET_MS = 5 * 60 * 60 * 1000;
const WEEKS = 8;
// Semáforo (aprobado por el usuario 2026-10-01).
const QUIET_DAYS = 7; // 🔴 7 días sin pedidos
const DROP_RATIO = 0.5; // 🟡 esta semana menos de la mitad de su promedio
const SHANGHAI_STORE_BRAND = "Importadora Shanghai";

const ecDay = (d: Date) => new Date(d.getTime() - EC_OFFSET_MS).toISOString().slice(0, 10);
const addDays = (day: string, n: number) => {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const mondayOf = (day: string) => {
  const dow = new Date(`${day}T12:00:00Z`).getUTCDay(); // 0 = domingo
  return addDays(day, -((dow + 6) % 7));
};
const isProvisionalAlf = (name: string) => /-\s*ALF\s*$/i.test(name.trim());

// IDs que cuentan como Importadora Shanghai: catálogo y combos marcados con
// esa marca, más los IDs provisionales "- ALF" (ALF = Alonfe, confirmado con
// las guías del 21–30/09). Devuelve código → nombre. Son pocas filas (≈20
// IDs de Shanghai hoy), así que se traen todas.
async function shanghaiCodeNames(): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const [items, combos, provisional] = await Promise.all([
    prisma.purchaseCatalogItem.findMany({ where: { justCode: { not: null }, bodega: "MKT_SHANGHAI" }, select: { justCode: true, name: true } }),
    prisma.dropiCombo.findMany({ where: { bodega: "MKT_SHANGHAI" }, select: { code: true, label: true } }),
    prisma.fulfillmentProvisionalLine.findMany({ where: { name: { contains: "ALF", mode: "insensitive" } }, select: { code: true, name: true }, distinct: ["code"] }),
  ]);
  for (const i of items) if (i.justCode) out.set(i.justCode, i.name);
  for (const c of combos) if (!out.has(c.code)) out.set(c.code, c.label?.trim() || `Combo ${c.code}`);
  for (const p of provisional) if (!out.has(p.code) && isProvisionalAlf(p.name)) out.set(p.code, p.name);
  return out;
}

// Al subir guías en un corte: cada ID de Shanghai que sale en la etiqueta de
// una tienda conocida (Store.labelSender) queda vinculado a esa tienda. Un ID
// ya vinculado nunca se mueve solo — eso lo decide Yair.
export async function linkProductsFromGuides(guides: { codes?: string[]; sender?: string | null }[]): Promise<number> {
  const withSender = guides.filter((g) => g.sender && g.codes && g.codes.length > 0);
  if (withSender.length === 0) return 0;
  const stores = await prisma.store.findMany({ where: { isActive: true, labelSender: { not: null } }, select: { id: true, labelSender: true } });
  if (stores.length === 0) return 0;
  const storeByCode = new Map<string, string>();
  for (const g of withSender) {
    const store = stores.find((s) => senderMatches(g.sender, s.labelSender!));
    if (!store) continue;
    for (const c of g.codes!) if (!storeByCode.has(c)) storeByCode.set(c, store.id);
  }
  if (storeByCode.size === 0) return 0;
  const names = await shanghaiCodeNames();
  const data = [...storeByCode.entries()].filter(([code]) => names.has(code)).map(([code, storeId]) => ({ code, name: names.get(code)!, storeId, source: "LABEL" }));
  if (data.length === 0) return 0;
  const r = await prisma.storeProductLink.createMany({ data, skipDuplicates: true });
  return r.count;
}

export type TrackingStatus = "VENDIENDO" | "BAJANDO" | "QUIETO" | "NUEVO";

export type TrackedProduct = {
  code: string;
  name: string;
  photo: string | null;
  source: string;
  linkedByName: string | null;
  // Pedidos por semana (lunes a domingo, hora de Ecuador), de la más vieja a la actual.
  weeks: { start: string; orders: number }[];
  last7: number;
  // Promedio semanal de las semanas completas anteriores con datos (máx. 4).
  prevAvg: number | null;
  lastOrderDay: string | null;
  daysWithoutOrders: number | null;
  status: TrackingStatus;
};

export type TrackedStore = { id: string; name: string; labelSender: string | null; products: TrackedProduct[] };

export type UnlinkedProduct = { code: string; name: string; orders: number; lastOrderDay: string };

export type StoreTrackingData = {
  today: string;
  historyStart: string | null;
  stores: TrackedStore[];
  unlinked: UnlinkedProduct[];
  storeOptions: { id: string; name: string }[];
};

// Día de cada guía: el del manifiesto si lo trae (los manifiestos atrasados
// se suben días después), si no el de la subida.
// Solo guías que traen alguno de `codes` (IDs de Shanghai o ya vinculados).
// firstDay = primer día con códigos guardados en CUALQUIER guía (para no
// confundir "no había datos" con "no se vendió").
async function guideDaysByCode(sinceDay: string, codes: string[]): Promise<{ byCode: Map<string, string[]>; firstDay: string | null }> {
  const since = new Date(new Date(`${sinceDay}T00:00:00Z`).getTime() + EC_OFFSET_MS);
  // Por subidas (pocas filas): los manifiestos atrasados se suben después de
  // su día real, así que se toma el día más viejo, no la primera subida.
  const batches = await prisma.fulfillmentRequestBatch.findMany({
    where: { guides: { some: { codes: { isEmpty: false } } } },
    select: { manifestDate: true, requestedAt: true },
  });
  const firstDay = batches.reduce<string | null>((min, b) => {
    const d = b.manifestDate ?? ecDay(b.requestedAt);
    return !min || d < min ? d : min;
  }, null);
  const byCode = new Map<string, string[]>();
  if (codes.length === 0) return { byCode, firstDay };
  const guides = await prisma.fulfillmentRequestGuide.findMany({
    where: { codes: { hasSome: codes }, batch: { requestedAt: { gte: since } } },
    select: { codes: true, batch: { select: { manifestDate: true, requestedAt: true } } },
  });
  const wanted = new Set(codes);
  for (const g of guides) {
    const day = g.batch.manifestDate ?? ecDay(g.batch.requestedAt);
    if (day < sinceDay) continue;
    for (const c of new Set(g.codes)) {
      if (!wanted.has(c)) continue;
      const arr = byCode.get(c);
      if (arr) arr.push(day);
      else byCode.set(c, [day]);
    }
  }
  return { byCode, firstDay };
}

function trend(days: string[], today: string, weekStarts: string[], historyStart: string | null) {
  const weeks = weekStarts.map((start) => ({ start, orders: days.filter((d) => d >= start && d < addDays(start, 7)).length }));
  const from7 = addDays(today, -(QUIET_DAYS - 1));
  const last7 = days.filter((d) => d >= from7 && d <= today).length;
  const lastOrderDay = days.length > 0 ? days.reduce((a, b) => (a > b ? a : b)) : null;
  const daysWithoutOrders = lastOrderDay ? Math.round((Date.parse(`${today}T12:00:00Z`) - Date.parse(`${lastOrderDay}T12:00:00Z`)) / 86400000) : null;
  // Semanas completas (7 días) antes de la ventana actual, solo desde que hay datos.
  const prevCounts: number[] = [];
  for (let k = 1; k <= 4; k++) {
    const end = addDays(from7, -(k - 1) * 7); // exclusivo
    const start = addDays(end, -7);
    if (!historyStart || start < historyStart) break;
    prevCounts.push(days.filter((d) => d >= start && d < end).length);
  }
  const prevAvg = prevCounts.length > 0 ? prevCounts.reduce((a, b) => a + b, 0) / prevCounts.length : null;
  let status: TrackingStatus;
  if (last7 === 0) status = "QUIETO";
  else if (prevAvg === null) status = "NUEVO";
  else if (last7 < prevAvg * DROP_RATIO) status = "BAJANDO";
  else status = "VENDIENDO";
  return { weeks, last7, prevAvg, lastOrderDay, daysWithoutOrders, status };
}

const STATUS_ORDER: Record<TrackingStatus, number> = { QUIETO: 0, BAJANDO: 1, NUEVO: 2, VENDIENDO: 3 };

export async function getStoreTrackingData(now = new Date()): Promise<StoreTrackingData> {
  const today = ecDay(now);
  const thisMonday = mondayOf(today);
  const weekStarts = Array.from({ length: WEEKS }, (_, i) => addDays(thisMonday, -(WEEKS - 1 - i) * 7));
  const sinceDay = weekStarts[0];

  const [stores, shanghai] = await Promise.all([
    prisma.store.findMany({
      where: { isActive: true, OR: [{ brand: SHANGHAI_STORE_BRAND }, { labelSender: { not: null } }, { productLinks: { some: {} } }] },
      orderBy: [{ order: "asc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        labelSender: true,
        productLinks: { select: { code: true, name: true, source: true, linkedBy: { select: { name: true } } } },
      },
    }),
    shanghaiCodeNames(),
  ]);

  const linkedCodes = stores.flatMap((s) => s.productLinks.map((l) => l.code));
  const from60 = addDays(today, -60);
  const { byCode, firstDay } = await guideDaysByCode(from60 < sinceDay ? from60 : sinceDay, [...new Set([...linkedCodes, ...shanghai.keys()])]);
  const photos = new Map(
    (await prisma.purchaseCatalogItem.findMany({ where: { justCode: { in: linkedCodes } }, select: { justCode: true, photos: true } })).map((i) => [i.justCode!, i.photos[0] ?? null])
  );

  const trackedStores: TrackedStore[] = stores.map((s) => ({
    id: s.id,
    name: s.name,
    labelSender: s.labelSender,
    products: s.productLinks
      .map((l) => ({
        code: l.code,
        name: l.name,
        photo: photos.get(l.code) ?? null,
        source: l.source,
        linkedByName: l.linkedBy?.name ?? null,
        ...trend(byCode.get(l.code) ?? [], today, weekStarts, firstDay),
      }))
      .sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || b.weeks.reduce((x, w) => x + w.orders, 0) - a.weeks.reduce((x, w) => x + w.orders, 0)),
  }));

  // IDs de Shanghai que se movieron en los últimos 60 días y no tienen tienda.
  const linked = new Set(linkedCodes);
  const unlinked: UnlinkedProduct[] = [...byCode.entries()]
    .filter(([c, days]) => !linked.has(c) && shanghai.has(c) && days.some((d) => d >= from60))
    .map(([code, days]) => {
      const recent = days.filter((d) => d >= from60);
      return { code, name: shanghai.get(code)!, orders: recent.length, lastOrderDay: recent.reduce((a, b) => (a > b ? a : b)) };
    })
    .sort((a, b) => b.orders - a.orders);

  return {
    today,
    historyStart: firstDay,
    stores: trackedStores,
    unlinked,
    storeOptions: stores.map((s) => ({ id: s.id, name: s.name })),
  };
}

// Pendiente de Yair en Inicio: IDs de Shanghai que se movieron sin tienda.
export async function getUnlinkedShanghaiCount(): Promise<number> {
  return (await getStoreTrackingData()).unlinked.length;
}

export async function linkStoreProduct(params: { code: string; storeId: string; userId: string | null }): Promise<{ ok: true } | { ok: false; error: string }> {
  const store = await prisma.store.findFirst({ where: { id: params.storeId, isActive: true }, select: { id: true } });
  if (!store) return { ok: false, error: "Esa tienda ya no existe." };
  const name = (await shanghaiCodeNames()).get(params.code);
  if (!name) return { ok: false, error: "Ese ID no es de Importadora Shanghai — solo esos se vinculan a una tienda." };
  await prisma.storeProductLink.upsert({
    where: { code: params.code },
    create: { code: params.code, name, storeId: store.id, source: "MANUAL", linkedById: params.userId },
    update: { storeId: store.id, source: "MANUAL", linkedById: params.userId },
  });
  return { ok: true };
}
