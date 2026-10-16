import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { ecuadorDay } from "@/lib/fulfillmentGuides";

// NICK Etapa 4 (aprobada 2026-10-16): rankings de tiendas, productos y
// transportadoras con el estado real de Dropi. SOLO el admin (él prueba
// primero). Sin montos. Sin cambios en la base.
// - El % se calcula solo con guías FINALIZADAS: entregadas + devueltas (en
//   devolución, rechazadas o canceladas después de salir en un corte).
// - Etiqueta: Buena ≤ 15% de devolución, Revisar 15–25%, Riesgo > 25%.
// - Mínimo 20 guías finalizadas para entrar al ranking (10 en "por ciudad").
// - Tiendas y productos salen de los cortes (remitente y productos de la
//   etiqueta, desde el corte del 21/09); transportadoras, de todas las guías de NICK.

export const RANK_MIN = 20;
const CITY_MIN = 10;

export type RankLabel = "BUENA" | "REVISAR" | "RIESGO";
export type RankRow = {
  key: string;
  name: string;
  guides: number;
  finished: number;
  delivered: number;
  returned: number;
  inTransit: number;
  novelty: number;
  deliveredPct: number;
  returnedPct: number;
  label: RankLabel;
};

export type NickRankings = {
  periodDays: number;
  stores: RankRow[];
  products: RankRow[];
  carriers: RankRow[];
  cityCarriers: RankRow[] | null;
  cities: string[];
};

const label = (returnedPct: number): RankLabel => (returnedPct <= 15 ? "BUENA" : returnedPct <= 25 ? "REVISAR" : "RIESGO");

type Agg = { key: string; name: string | null; guides: bigint; delivered: bigint; returned: bigint; in_transit: bigint; novelty: bigint };

function toRows(rows: Agg[], min: number): RankRow[] {
  return rows
    .map((r) => {
      const delivered = Number(r.delivered);
      const returned = Number(r.returned);
      const finished = delivered + returned;
      const returnedPct = finished ? Math.round((returned / finished) * 1000) / 10 : 0;
      return {
        key: r.key,
        name: r.name ?? r.key,
        guides: Number(r.guides),
        finished,
        delivered,
        returned,
        inTransit: Number(r.in_transit),
        novelty: Number(r.novelty),
        deliveredPct: finished ? Math.round((delivered / finished) * 1000) / 10 : 0,
        returnedPct,
        label: label(returnedPct),
      };
    })
    .filter((r) => r.finished >= min)
    .sort((a, b) => b.returnedPct - a.returnedPct || b.finished - a.finished);
}

// Columnas comunes de conteo por grupo de estado.
const COUNTS = Prisma.sql`
  count(*) guides,
  count(*) FILTER (WHERE s."statusGroup" = 'ENTREGADA') delivered,
  count(*) FILTER (WHERE s."statusGroup" IN ('DEVOLUCION', 'CANCELADA')) returned,
  count(*) FILTER (WHERE s."statusGroup" IN ('EN_CAMINO', 'PREPARANDO')) in_transit,
  count(*) FILTER (WHERE s."statusGroup" = 'NOVEDAD') novelty`;

export async function getNickRankings({ days = 30, account = null as string | null, city = null as string | null } = {}): Promise<NickRankings> {
  const periodDays = [7, 30, 45].includes(days) ? days : 30;
  const fromDay = ecuadorDay(new Date(Date.now() - periodDays * 864e5));
  const fromDate = new Date(Date.now() - periodDays * 864e5);
  const acc = account ? Prisma.sql`AND s."accountId" = ${account}` : Prisma.empty;
  const join = Prisma.sql`FROM "NickGuideStatus" s JOIN "FulfillmentRequestGuide" g ON upper(replace(g."guideNumber", ' ', '')) = s."guideNumber"`;

  const stores = await prisma.$queryRaw<Agg[]>`
    SELECT g."sender" key, g."sender" name, ${COUNTS}
    ${join}
    WHERE g."manifestDay" >= ${fromDay} AND g."sender" IS NOT NULL ${acc}
    GROUP BY g."sender"`;

  // Un producto cuenta una vez por guía aunque venga en varias unidades.
  const products = await prisma.$queryRaw<Agg[]>`
    SELECT p.code key, max(p.name) name, ${COUNTS}
    ${join}
    CROSS JOIN LATERAL (
      SELECT DISTINCT lp->>'code' code, lp->>'name' name
      FROM jsonb_array_elements(CASE WHEN jsonb_typeof(g."labelProducts") = 'array' THEN g."labelProducts" ELSE '[]'::jsonb END) lp
      WHERE lp->>'code' IS NOT NULL
    ) p
    WHERE g."manifestDay" >= ${fromDay} ${acc}
    GROUP BY p.code`;

  const carriers = await prisma.$queryRaw<Agg[]>`
    SELECT s."carrier" key, s."carrier" name, ${COUNTS}
    FROM "NickGuideStatus" s
    WHERE s."carrier" IS NOT NULL AND s."orderCreatedAt" >= ${fromDate} ${acc}
    GROUP BY s."carrier"`;

  const cityList = await prisma.$queryRaw<{ city: string; n: bigint }[]>`
    SELECT s."city" city, count(*) n FROM "NickGuideStatus" s
    WHERE s."city" IS NOT NULL AND s."orderCreatedAt" >= ${fromDate} ${acc}
    GROUP BY s."city" HAVING count(*) >= ${CITY_MIN} ORDER BY count(*) DESC`;

  const cityCarriers = city
    ? toRows(
        await prisma.$queryRaw<Agg[]>`
          SELECT s."carrier" key, s."carrier" name, ${COUNTS}
          FROM "NickGuideStatus" s
          WHERE s."carrier" IS NOT NULL AND s."city" = ${city} AND s."orderCreatedAt" >= ${fromDate} ${acc}
          GROUP BY s."carrier"`,
        CITY_MIN,
      ).sort((a, b) => a.returnedPct - b.returnedPct)
    : null;

  return {
    periodDays,
    stores: toRows(stores, RANK_MIN),
    products: toRows(products, RANK_MIN),
    carriers: toRows(carriers, RANK_MIN).sort((a, b) => a.returnedPct - b.returnedPct),
    cityCarriers,
    cities: cityList.map((c) => c.city),
  };
}
