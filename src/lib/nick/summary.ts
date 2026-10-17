import { prisma } from "@/lib/prisma";
import { getNickScore, type NickScore } from "@/lib/nick/score";
import { getNickAttention } from "@/lib/nick/attention";
import { NICK_ATTENTION, type NickAttentionKey } from "@/lib/nick/attentionLabels";

// NICK — pestaña Resumen (aprobada 2026-10-17, solo el admin): la operación
// de un vistazo, como ATOM pero comparando con el período anterior.
// - Volumen (pedidos, en camino, novedad): por fecha de creación de la orden
//   en el período elegido (7, 15 o 30 días) contra el período anterior.
// - % de entrega y de devolución: solo con órdenes "maduras", de hace 15 a 30
//   días, contra las de hace 30 a 45. Con datos reales, una devolución tarda
//   ~15 días en aparecer: con la última semana saldría un falso 98% de entrega.
// - Días hasta entregar: también con órdenes maduras (con las recientes solo
//   cuentan las rápidas) y solo guías que NICK vio antes de entregarse (las
//   leídas ya entregadas no dicen cuándo se entregaron). Mínimo 20 guías.

export const MATURE_FROM_DAYS = 15;
export const MATURE_SPAN_DAYS = 15;

export type SummaryNumbers = {
  guides: number;
  delivered: number;
  returned: number;
  inTransit: number;
  novelty: number;
  deliveredPct: number | null;
  returnedPct: number | null;
};

export type NickSummary = {
  periodDays: number;
  current: SummaryNumbers;
  previous: SummaryNumbers;
  mature: SummaryNumbers;
  maturePrevious: SummaryNumbers;
  deliveryDays: { avg: number | null; guides: number; previousAvg: number | null };
  accounts: { id: string; name: string; period: SummaryNumbers; mature: SummaryNumbers }[];
  daily: { day: string; guides: number; delivered: number; returned: number; open: number }[];
  attention: { key: NickAttentionKey; label: string; hint: string; count: number }[];
  score: Pick<NickScore, "score" | "color" | "provisional" | "recommendations" | "money" | "trend">;
};

type Row = { guides: bigint; delivered: bigint; returned: bigint; in_transit: bigint; novelty: bigint };

const pct = (a: number, b: number) => (b ? Math.round((a / b) * 1000) / 10 : null);
function numbers(r: Row | undefined): SummaryNumbers {
  const delivered = Number(r?.delivered ?? 0);
  const returned = Number(r?.returned ?? 0);
  return {
    guides: Number(r?.guides ?? 0),
    delivered,
    returned,
    inTransit: Number(r?.in_transit ?? 0),
    novelty: Number(r?.novelty ?? 0),
    deliveredPct: pct(delivered, delivered + returned),
    returnedPct: pct(returned, delivered + returned),
  };
}

// Conteos por cuenta entre dos fechas de creación de la orden.
async function countBetween(from: Date, to: Date) {
  const rows = await prisma.$queryRaw<(Row & { accountId: string })[]>`
    SELECT s."accountId",
      count(*) guides,
      count(*) FILTER (WHERE s."statusGroup" = 'ENTREGADA') delivered,
      count(*) FILTER (WHERE s."statusGroup" IN ('DEVOLUCION', 'CANCELADA')) returned,
      count(*) FILTER (WHERE s."statusGroup" IN ('EN_CAMINO', 'PREPARANDO')) in_transit,
      count(*) FILTER (WHERE s."statusGroup" = 'NOVEDAD') novelty
    FROM "NickGuideStatus" s
    WHERE s."orderCreatedAt" >= ${from} AND s."orderCreatedAt" < ${to}
    GROUP BY 1`;
  const total = rows.reduce<Row>(
    (a, r) => ({
      guides: a.guides + r.guides,
      delivered: a.delivered + r.delivered,
      returned: a.returned + r.returned,
      in_transit: a.in_transit + r.in_transit,
      novelty: a.novelty + r.novelty,
    }),
    { guides: BigInt(0), delivered: BigInt(0), returned: BigInt(0), in_transit: BigInt(0), novelty: BigInt(0) },
  );
  return { total: numbers(total), byAccount: new Map(rows.map((r) => [r.accountId, numbers(r)])) };
}

async function avgDeliveryDays(from: Date, to: Date) {
  const [r] = await prisma.$queryRaw<{ avg: number | null; n: bigint }[]>`
    SELECT avg(EXTRACT(EPOCH FROM (c."at" - s."orderCreatedAt")) / 86400)::float avg, count(*) n
    FROM "NickGuideStatus" s
    JOIN LATERAL (
      SELECT min(x."at") at FROM "NickGuideStatusChange" x
      WHERE x."guideNumber" = s."guideNumber" AND x."toStatus" = 'ENTREGADO' AND x."fromStatus" IS NOT NULL
    ) c ON c."at" IS NOT NULL
    WHERE s."statusGroup" = 'ENTREGADA' AND s."orderCreatedAt" >= ${from} AND s."orderCreatedAt" < ${to}`;
  return { avg: r?.avg == null ? null : Math.round(r.avg * 10) / 10, n: Number(r?.n ?? 0) };
}

export async function getNickSummary({ days = 7 } = {}, now = new Date()): Promise<NickSummary> {
  const periodDays = [7, 15, 30].includes(days) ? days : 7;
  const ago = (d: number) => new Date(now.getTime() - d * 864e5);

  const [cur, prev, mat, matPrev, accounts, daily, dCur, dPrev, att, score] = await Promise.all([
    countBetween(ago(periodDays), now),
    countBetween(ago(2 * periodDays), ago(periodDays)),
    countBetween(ago(MATURE_FROM_DAYS + MATURE_SPAN_DAYS), ago(MATURE_FROM_DAYS)),
    countBetween(ago(MATURE_FROM_DAYS + 2 * MATURE_SPAN_DAYS), ago(MATURE_FROM_DAYS + MATURE_SPAN_DAYS)),
    prisma.nickDropiAccount.findMany({ orderBy: { sortOrder: "asc" }, select: { id: true, name: true } }),
    // Últimos 45 días por día de Ecuador (UTC − 5 h).
    prisma.$queryRaw<{ day: string; guides: bigint; delivered: bigint; returned: bigint }[]>`
      SELECT to_char(s."orderCreatedAt" - interval '5 hours', 'YYYY-MM-DD') AS "day",
        count(*) guides,
        count(*) FILTER (WHERE s."statusGroup" = 'ENTREGADA') delivered,
        count(*) FILTER (WHERE s."statusGroup" IN ('DEVOLUCION', 'CANCELADA')) returned
      FROM "NickGuideStatus" s
      WHERE s."orderCreatedAt" >= ${ago(45)}
      GROUP BY 1 ORDER BY 1`,
    avgDeliveryDays(ago(MATURE_FROM_DAYS + MATURE_SPAN_DAYS), ago(MATURE_FROM_DAYS)),
    avgDeliveryDays(ago(MATURE_FROM_DAYS + 2 * MATURE_SPAN_DAYS), ago(MATURE_FROM_DAYS + MATURE_SPAN_DAYS)),
    getNickAttention(now, { estimates: true }),
    getNickScore(now),
  ]);

  return {
    periodDays,
    current: cur.total,
    previous: prev.total,
    mature: mat.total,
    maturePrevious: matPrev.total,
    deliveryDays: { avg: dCur.n >= 20 ? dCur.avg : null, guides: dCur.n, previousAvg: dPrev.n >= 20 ? dPrev.avg : null },
    accounts: accounts.map((a) => ({
      id: a.id,
      name: a.name,
      period: cur.byAccount.get(a.id) ?? numbers(undefined),
      mature: mat.byAccount.get(a.id) ?? numbers(undefined),
    })),
    daily: daily.map((d) => {
      const guides = Number(d.guides);
      const delivered = Number(d.delivered);
      const returned = Number(d.returned);
      return { day: d.day, guides, delivered, returned, open: guides - delivered - returned };
    }),
    attention: NICK_ATTENTION.map((a) => ({ key: a.key, label: a.label, hint: a.hint, count: att[a.key]?.size ?? 0 })),
    score: {
      score: score.score,
      color: score.color,
      provisional: score.provisional,
      recommendations: score.recommendations,
      money: score.money,
      trend: score.trend,
    },
  };
}
