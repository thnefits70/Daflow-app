import { unstable_cache } from "next/cache";
import { prisma } from "@/lib/prisma";

// Qué transportadora entrega mejor, en general y por ciudad (2026-10-17): de
// TODOS nuestros envíos en Dropi de los últimos 60 días (NICK). Lo usan Michelle
// IA y la sección "Qué transportadora entrega mejor" de provedix.com. Solo
// porcentajes y días: nunca cantidades de guías ni datos de una tienda.

export type CarrierRate = { carrier: string; pct: number; days: number | null };
export type CityCarriers = { city: string; carriers: CarrierRate[]; similar: boolean };
export type CarrierStats = { general: CarrierRate[]; cities: CityCarriers[] };

const CARRIER_NAME: Record<string, string> = { SERVIENTREGA: "Servientrega", GINTRACOM: "Gintracom", LAARCOURIER: "LaarCourier", VELOCES: "Veloces", URBANO: "Urbano" };
const carrierName = (c: string) => CARRIER_NAME[c.toUpperCase().replace(/\s+/g, "")] ?? c;

// Solo se comparan las que mueven volumen de verdad (10%+ de los envíos): un
// 88% sobre 25 guías no vale lo mismo que un 77% sobre 1.000 (caso Urbano en
// Quito, corrección del usuario 2026-10-17).
const MIN_SHARE = 0.1;
const MIN_CITY_GUIDES = 25;
const TOP_CITIES = 25;
// Menos de 3 puntos de diferencia = "entregan parecido".
const SIMILAR_POINTS = 3;

// Cuánto tarda cada transportadora (pedido del usuario 2026-10-17): desde el día
// del corte (manifestDay) hasta que NICK ve la guía pasar a ENTREGADA (revisa cada
// 2 h). Dropi no da la fecha de entrega, así que solo cuentan las entregas que
// NICK vio cambiar (desde el 2026-10-16); las que ya estaban entregadas no tienen
// hora. Para no sesgar (si solo cuentan las que ya llegaron, salen más rápidas de
// lo real) se miden guías que salieron desde que NICK empezó y que ya tuvieron
// 10+ días para llegar. Días contados sin domingos. Se usa solo con MIN_TIMED+.
const MIN_TIMED = 20;
type Timed = { carrier: string | null; city: string | null; day: string; delivered: string };

function daysWithoutSundays(from: string, to: string): number {
  const d = new Date(`${from}T12:00:00Z`);
  const end = new Date(`${to}T12:00:00Z`);
  let n = 0;
  while (d < end) {
    d.setUTCDate(d.getUTCDate() + 1);
    if (d.getUTCDay() !== 0) n++;
  }
  return n;
}

function medianDays(xs: number[] | undefined): number | null {
  if (!xs || xs.length < MIN_TIMED) return null;
  const a = [...xs].sort((x, y) => x - y);
  const m = Math.floor(a.length / 2);
  return Math.round(a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2);
}

async function carrierSpeed(): Promise<{ byCarrier: Map<string, number[]>; byCity: Map<string, number[]> }> {
  const rows = await prisma.$queryRaw<Timed[]>`
    SELECT DISTINCT ON (c."guideNumber") g.carrier, g.city, f."manifestDay" AS day,
      ((c.at AT TIME ZONE 'UTC') AT TIME ZONE 'America/Guayaquil')::date::text AS delivered
    FROM "NickGuideStatusChange" c
    JOIN "NickGuideStatus" g ON g."guideNumber" = c."guideNumber"
    JOIN "FulfillmentRequestGuide" f ON f."guideNumber" = c."guideNumber"
    WHERE c."fromStatus" IS NOT NULL AND g."statusGroup" = 'ENTREGADA' AND c."toStatus" = g.status
      AND f."manifestDay" >= (SELECT min("firstSeenAt")::date::text FROM "NickGuideStatus")
      AND f."manifestDay" >= (now() - interval '60 days')::date::text
      AND f."manifestDay" <= ((now() AT TIME ZONE 'America/Guayaquil') - interval '10 days')::date::text
    ORDER BY c."guideNumber", c.at`;
  const byCarrier = new Map<string, number[]>();
  const byCity = new Map<string, number[]>();
  for (const r of rows) {
    if (!r.carrier || r.delivered < r.day) continue;
    const carrier = carrierName(r.carrier);
    const days = daysWithoutSundays(r.day, r.delivered);
    if (days > 20) continue; // perdida o mal escaneada: no es un tiempo normal
    byCarrier.set(carrier, [...(byCarrier.get(carrier) ?? []), days]);
    const city = (r.city ?? "").trim().toUpperCase();
    if (city) byCity.set(`${city}|${carrier}`, [...(byCity.get(`${city}|${carrier}`) ?? []), days]);
  }
  return { byCarrier, byCity };
}

async function computeCarrierStats(): Promise<CarrierStats> {
  const since = new Date(Date.now() - 60 * 86_400_000);
  const [rows, speed] = await Promise.all([
    prisma.nickGuideStatus.groupBy({
      by: ["city", "carrier", "statusGroup"],
      where: { orderCreatedAt: { gte: since }, statusGroup: { in: ["ENTREGADA", "DEVOLUCION"] }, carrier: { not: null } },
      _count: { _all: true },
    }),
    carrierSpeed().catch(() => ({ byCarrier: new Map<string, number[]>(), byCity: new Map<string, number[]>() })),
  ]);
  type Tally = { ok: number; total: number };
  const byCarrier = new Map<string, Tally>();
  const byCity = new Map<string, Map<string, Tally>>();
  for (const r of rows) {
    const carrier = carrierName(r.carrier ?? "");
    const n = r._count._all;
    const ok = r.statusGroup === "ENTREGADA" ? n : 0;
    const c = byCarrier.get(carrier) ?? { ok: 0, total: 0 };
    byCarrier.set(carrier, { ok: c.ok + ok, total: c.total + n });
    const city = (r.city ?? "").trim().toUpperCase();
    if (!city) continue;
    if (!byCity.has(city)) byCity.set(city, new Map());
    const cc = byCity.get(city)!.get(carrier) ?? { ok: 0, total: 0 };
    byCity.get(city)!.set(carrier, { ok: cc.ok + ok, total: cc.total + n });
  }
  const pct = (x: Tally) => Math.round((x.ok / x.total) * 100);
  const allTotal = [...byCarrier.values()].reduce((s, x) => s + x.total, 0);
  const general = [...byCarrier]
    .filter(([, x]) => x.total >= allTotal * MIN_SHARE)
    .sort((a, b) => pct(b[1]) - pct(a[1]))
    .map(([carrier, x]) => ({ carrier, pct: pct(x), days: medianDays(speed.byCarrier.get(carrier)) }));
  const cities = [...byCity]
    .map(([city, m]) => ({ city, m, total: [...m.values()].reduce((s, x) => s + x.total, 0) }))
    .sort((a, b) => b.total - a.total)
    .slice(0, TOP_CITIES)
    .flatMap(({ city, m, total }) => {
      const carriers = [...m]
        .filter(([, x]) => x.total >= MIN_CITY_GUIDES && x.total >= total * MIN_SHARE)
        .sort((a, b) => pct(b[1]) - pct(a[1]))
        .slice(0, 2)
        .map(([carrier, x]) => ({ carrier, pct: pct(x), days: medianDays(speed.byCity.get(`${city}|${carrier}`)) }));
      if (!carriers.length) return [];
      return [{ city, carriers, similar: carriers.length > 1 && carriers[0].pct - carriers[1].pct < SIMILAR_POINTS }];
    });
  return { general, cities };
}

export const getCarrierStats = unstable_cache(computeCarrierStats, ["pvx-carrier-stats-v1"], { revalidate: 6 * 3600 });
