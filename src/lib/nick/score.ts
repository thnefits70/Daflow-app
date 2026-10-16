import { prisma } from "@/lib/prisma";
import { addBusinessDays } from "@/lib/businessHours";
import { ecuadorDay } from "@/lib/fulfillmentGuides";
import { statusGroup } from "@/lib/nick/sync";
import { getNickAttention } from "@/lib/nick/attention";
import { getNickRankings } from "@/lib/nick/rankings";
import { currentDropiPrices } from "@/lib/dropiPriceChanges";
import { resolveCostBasisForCatalogItems } from "@/lib/marketProduct";

// NICK Etapa 3 (aprobada 2026-10-16): marcador de 100 puntos, SOLO admin.
// Se explica como "puntos" (nunca "peso" ni "nota", pedido del usuario):
// - Pedidos entregados: hasta 40 puntos (entregadas / finalizadas, 30 días).
// - Guías que se mueven: hasta 20 (en camino que NO llevan 3+ días
//   laborables sin cambio, según lo que NICK observó).
// - Novedades resueltas: hasta 20 (novedades que NICK vio empezar y que
//   siguieron a entrega/camino en vez de devolución o quedarse 2+ días).
// - Devoluciones que volvieron a bodega: hasta 20 (escaneadas en Reingresos).
// Una parte sin datos suficientes queda en "se empieza a medir" (null) y el
// total se calcula con las demás (provisional). Verde 85+, amarillo 70–84,
// rojo < 70.

const WINDOW_DAYS = 30;
const STUCK_DAYS = 3;
const NOVELTY_RESOLVE_DAYS = 2;
const RETURN_DAYS = 5;
const RETURN_FALLBACK_DAYS = 15;
const REENTRY_FROM = new Date("2026-09-19T05:00:00Z");

export type ScorePart = { key: string; label: string; max: number; points: number | null; pct: number | null; detail: string };
export type NickScore = {
  day: string;
  score: number | null;
  color: "VERDE" | "AMARILLO" | "ROJO" | null;
  provisional: boolean;
  parts: ScorePart[];
  summary: { guides: number; deliveredPct: number; returnedPct: number; inTransit: number; novelty: number };
  trend: { day: string; score: number | null }[];
  recommendations: string[];
  money: {
    atRisk: number;
    atRiskGuides: number;
    lost: number;
    lostGuides: number;
    recovered: number;
    recoveredGuides: number;
    missingPrices: number;
  } | null;
};

const due = (since: Date, days: number, now: Date) => addBusinessDays(since, days).getTime() <= now.getTime();
const r1 = (n: number) => Math.round(n * 10) / 10;
const color = (s: number) => (s >= 85 ? "VERDE" : s >= 70 ? "AMARILLO" : "ROJO") as NickScore["color"];

async function computeParts(now: Date) {
  const since = new Date(now.getTime() - WINDOW_DAYS * 864e5);

  // 1. Entregados (40).
  const g = await prisma.nickGuideStatus.groupBy({ by: ["statusGroup"], where: { orderCreatedAt: { gte: since } }, _count: true });
  const c = (k: string) => g.find((x) => x.statusGroup === k)?._count ?? 0;
  const delivered = c("ENTREGADA");
  const returned = c("DEVOLUCION") + c("CANCELADA");
  const finished = delivered + returned;
  const total = g.reduce((a, x) => a + x._count, 0);
  const deliveredRate = finished >= 20 ? delivered / finished : null;

  // 2. Guías que se mueven (20): solo cuando NICK ya lleva 3 días laborables mirando.
  const first = await prisma.nickGuideStatus.findFirst({ orderBy: { firstSeenAt: "asc" }, select: { firstSeenAt: true } });
  const moving = await prisma.nickGuideStatus.findMany({ where: { statusGroup: "EN_CAMINO" }, select: { statusSince: true } });
  const canMeasureMove = !!first && due(first.firstSeenAt, STUCK_DAYS, now) && moving.length >= 20;
  const stuck = moving.filter((m) => due(m.statusSince, STUCK_DAYS, now)).length;
  const moveRate = canMeasureMove ? 1 - stuck / moving.length : null;

  // 3. Novedades resueltas (20): episodios que NICK vio empezar en 30 días.
  const changes = await prisma.nickGuideStatusChange.findMany({ where: { at: { gte: since } }, orderBy: { at: "asc" }, select: { guideNumber: true, fromStatus: true, toStatus: true, at: true } });
  const byGuide = new Map<string, typeof changes>();
  for (const ch of changes) byGuide.set(ch.guideNumber, [...(byGuide.get(ch.guideNumber) ?? []), ch]);
  let resolved = 0;
  let failed = 0;
  for (const list of byGuide.values()) {
    list.forEach((ch, i) => {
      if (!ch.fromStatus || statusGroup(ch.toStatus) !== "NOVEDAD" || statusGroup(ch.fromStatus) === "NOVEDAD") return;
      const next = list.slice(i + 1).find((x) => statusGroup(x.toStatus) !== "NOVEDAD");
      if (next) {
        const grp = statusGroup(next.toStatus);
        const ok = (grp === "ENTREGADA" || grp === "EN_CAMINO" || grp === "PREPARANDO") && !due(ch.at, NOVELTY_RESOLVE_DAYS, next.at);
        if (ok) resolved++;
        else failed++;
      } else if (due(ch.at, NOVELTY_RESOLVE_DAYS, now)) failed++;
    });
  }
  const noveltyRate = resolved + failed >= 10 ? resolved / (resolved + failed) : null;

  // 4. Devoluciones que volvieron a bodega (20).
  const rets = await prisma.$queryRaw<{ guideNumber: string; statusSince: Date; firstSeenAt: Date; orderCreatedAt: Date | null; scanned: boolean }[]>`
    SELECT s."guideNumber", s."statusSince", s."firstSeenAt", s."orderCreatedAt", (r.id IS NOT NULL) scanned
    FROM "NickGuideStatus" s
    LEFT JOIN "MerchandiseReentryGuide" r ON upper(replace(r."guideNumber", ' ', '')) = s."guideNumber"
    WHERE s."statusGroup" = 'DEVOLUCION' AND s."orderCreatedAt" >= ${REENTRY_FROM}`;
  const eligible = rets.filter((x) =>
    x.scanned ||
    (x.statusSince.getTime() > x.firstSeenAt.getTime()
      ? due(x.statusSince, RETURN_DAYS, now)
      : !!x.orderCreatedAt && now.getTime() - x.orderCreatedAt.getTime() >= RETURN_FALLBACK_DAYS * 864e5),
  );
  const scannedReturns = eligible.filter((x) => x.scanned);
  const recoveryRate = eligible.length >= 20 ? scannedReturns.length / eligible.length : null;

  const parts: ScorePart[] = [
    {
      key: "delivered",
      label: "Pedidos entregados",
      max: 40,
      pct: deliveredRate,
      points: deliveredRate == null ? null : r1(deliveredRate * 40),
      detail: `${delivered.toLocaleString("es-EC")} entregadas de ${finished.toLocaleString("es-EC")} finalizadas (30 días)`,
    },
    {
      key: "movement",
      label: "Guías que se mueven",
      max: 20,
      pct: moveRate,
      points: moveRate == null ? null : r1(moveRate * 20),
      detail: canMeasureMove ? `${stuck} de ${moving.length} en camino llevan 3+ días laborables sin cambio` : "Se empieza a medir: NICK necesita 3 días laborables mirando",
    },
    {
      key: "novelty",
      label: "Novedades resueltas",
      max: 20,
      pct: noveltyRate,
      points: noveltyRate == null ? null : r1(noveltyRate * 20),
      detail: noveltyRate == null ? `Se empieza a medir (${resolved + failed} novedades vistas; hacen falta 10)` : `${resolved} resueltas de ${resolved + failed} novedades`,
    },
    {
      key: "recovery",
      label: "Devoluciones que volvieron a bodega",
      max: 20,
      pct: recoveryRate,
      points: recoveryRate == null ? null : r1(recoveryRate * 20),
      detail: `${scannedReturns.length} escaneadas en Reingresos de ${eligible.length} devoluciones (órdenes desde el 19/09)`,
    },
  ];
  const measured = parts.filter((p) => p.points != null);
  const maxMeasured = measured.reduce((a, p) => a + p.max, 0);
  const score = maxMeasured ? r1((measured.reduce((a, p) => a + (p.points ?? 0), 0) / maxMeasured) * 100) : null;

  return {
    parts,
    score,
    provisional: measured.length < parts.length,
    summary: {
      guides: total,
      deliveredPct: finished ? r1((delivered / finished) * 100) : 0,
      returnedPct: finished ? r1((returned / finished) * 100) : 0,
      inTransit: c("EN_CAMINO") + c("PREPARANDO"),
      novelty: c("NOVEDAD"),
    },
    returnGuides: { lost: eligible.filter((x) => !x.scanned).map((x) => x.guideNumber), recovered: scannedReturns.map((x) => x.guideNumber) },
  };
}

// Guarda el marcador del día (para la tendencia). Lo llama la campanita de
// NICK como mucho una vez cada 3 horas, y la pantalla del admin.
export async function saveNickScoreDay(now = new Date()) {
  const day = ecuadorDay(now);
  const existing = await prisma.nickScoreDay.findUnique({ where: { day }, select: { updatedAt: true } });
  if (existing && now.getTime() - existing.updatedAt.getTime() < 3 * 3600 * 1000) return;
  const { parts, score } = await computeParts(now);
  const pts = (k: string) => parts.find((p) => p.key === k)?.points ?? null;
  const data = { score, delivered: pts("delivered"), movement: pts("movement"), novelty: pts("novelty"), recovery: pts("recovery") };
  await prisma.nickScoreDay.upsert({ where: { day }, create: { day, ...data }, update: data });
}

// Precio que paga Dropi (confirmado por la asesora B2B o el calculado) y costo
// por unidad de cada producto de las etiquetas.
export async function productValues(guides: string[]) {
  if (!guides.length) return { byGuide: new Map<string, { price: number | null; cost: number | null }>() };
  const rows = await prisma.fulfillmentRequestGuide.findMany({ where: { guideNumber: { in: guides } }, select: { guideNumber: true, labelProducts: true } });
  const lines = rows.flatMap((g) =>
    (Array.isArray(g.labelProducts) ? (g.labelProducts as { code?: string; qty?: number }[]) : [])
      .filter((p) => p.code)
      .map((p) => ({ guide: g.guideNumber.toUpperCase().replace(/\s+/g, ""), code: String(p.code), qty: Number(p.qty) || 1 })),
  );
  const items = await prisma.purchaseCatalogItem.findMany({ where: { justCode: { in: [...new Set(lines.map((l) => l.code))] } }, select: { id: true, justCode: true, dropiPriceRef: true } });
  const byCode = new Map(items.map((i) => [i.justCode!, i]));
  const ids = items.map((i) => i.id);
  const [prices, bases] = await Promise.all([currentDropiPrices(ids), resolveCostBasisForCatalogItems(ids)]);
  const byGuide = new Map<string, { price: number | null; cost: number | null }>();
  for (const l of lines) {
    const it = byCode.get(l.code);
    const b = it ? bases.get(it.id) : undefined;
    const price = it ? (it.dropiPriceRef ?? prices.get(it.id) ?? null) : null;
    const cost = b ? (b.batchCost + (b.freightCost ?? 0)) / (b.batchUnits || 1) : null;
    const cur = byGuide.get(l.guide) ?? { price: 0, cost: 0 };
    byGuide.set(l.guide, {
      price: cur.price == null || price == null ? null : cur.price + price * l.qty,
      cost: cur.cost == null || cost == null ? null : cur.cost + cost * l.qty,
    });
  }
  return { byGuide };
}

export async function getNickScore(now = new Date()): Promise<NickScore> {
  const base = await computeParts(now);
  await saveNickScoreDay(now).catch(() => null);
  const trendRows = await prisma.nickScoreDay.findMany({ where: { day: { gte: ecuadorDay(new Date(now.getTime() - 60 * 864e5)) } }, orderBy: { day: "asc" }, select: { day: true, score: true } });

  // Recomendaciones con los datos reales.
  const [att, rk] = await Promise.all([getNickAttention(now, { estimates: true }), getNickRankings({ days: 30 })]);
  const rec: string[] = [];
  const lost = base.returnGuides.lost.length;
  if (lost) rec.push(`${lost} devoluciones no aparecen escaneadas en Reingresos: revisar con Daniel si volvieron a la bodega.`);
  if (att.ESTANCADA.size) rec.push(`${att.ESTANCADA.size} guías en camino sin movimiento: reclamar a la transportadora.`);
  if (att.CANCELADA_TRAS_SALIR.size) rec.push(`${att.CANCELADA_TRAS_SALIR.size} guías canceladas o rechazadas después de salir: confirmar que el producto regresó.`);
  const worstCarrier = rk.carriers.filter((x) => x.label === "RIESGO").sort((a, b) => b.returnedPct - a.returnedPct)[0];
  const bestCarrier = [...rk.carriers].sort((a, b) => a.returnedPct - b.returnedPct)[0];
  if (worstCarrier && bestCarrier && worstCarrier.key !== bestCarrier.key)
    rec.push(`${worstCarrier.name} devuelve ${worstCarrier.returnedPct}% y ${bestCarrier.name} ${bestCarrier.returnedPct}%: mira "Mejor transportadora por ciudad" en Rankings.`);
  const riskStores = rk.stores.filter((s) => s.label === "RIESGO");
  if (riskStores.length) rec.push(`${riskStores.length} tiendas con más de 25% de devolución; la que más devuelve: ${riskStores[0].name} (${riskStores[0].returnedPct}%).`);
  const riskProducts = rk.products.filter((p) => p.label === "RIESGO");
  if (riskProducts.length) rec.push(`${riskProducts.length} productos con más de 25% de devolución; el que más: ${riskProducts[0].name} (${riskProducts[0].returnedPct}%). Revísalo antes de recomprar.`);

  // Impacto en dinero (solo admin).
  const riskGuides = [...new Set([...att.ESTANCADA.keys(), ...att.NOVEDAD_ABIERTA.keys()])];
  const { byGuide } = await productValues([...riskGuides, ...base.returnGuides.lost, ...base.returnGuides.recovered]);
  let missingPrices = 0;
  const sum = (guides: string[], f: "price" | "cost") =>
    guides.reduce((a, gn) => {
      const v = byGuide.get(gn)?.[f];
      if (v == null) {
        missingPrices++;
        return a;
      }
      return a + v;
    }, 0);
  const money = {
    atRisk: Math.round(sum(riskGuides, "price")),
    atRiskGuides: riskGuides.length,
    lost: Math.round(sum(base.returnGuides.lost, "cost")),
    lostGuides: base.returnGuides.lost.length,
    recovered: Math.round(sum(base.returnGuides.recovered, "cost")),
    recoveredGuides: base.returnGuides.recovered.length,
    missingPrices,
  };

  return {
    day: ecuadorDay(now),
    score: base.score,
    color: base.score == null ? null : color(base.score),
    provisional: base.provisional,
    parts: base.parts,
    summary: base.summary,
    trend: trendRows,
    recommendations: rec,
    money,
  };
}
