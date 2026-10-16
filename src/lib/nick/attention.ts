import { prisma } from "@/lib/prisma";
import { addBusinessDays } from "@/lib/businessHours";

// NICK Etapa 2 (aprobada 2026-10-16): "Requiere atención". Pedido del
// usuario: NO sale ningún aviso a nadie (ni Inicio, ni celular); todo se ve
// solo dentro de NICK, como en ATOM. Las 5 listas salen de lo que NICK ya
// guarda + Reingresos + guías canceladas/retenidas, sin cambios en la base.

import { NICK_ATTENTION, type NickAttentionKey } from "@/lib/nick/attentionLabels";

export { NICK_ATTENTION, type NickAttentionKey };

const STUCK_DAYS = 3;
const NOVELTY_DAYS = 1;
const RETURN_DAYS = 5;
// Reingresos se empezó a usar el 2026-10-03: las devoluciones de órdenes de
// antes del 19/09 (2 semanas antes) nunca se escanearon, así que no cuentan.
const REENTRY_FROM = new Date("2026-09-19T05:00:00Z");
// Si NICK no vio el cambio (la guía ya estaba en devolución al leerla por
// primera vez), se toma la fecha de la orden + 15 días como referencia.
const RETURN_FALLBACK_DAYS = 15;
// Pedido del usuario 2026-10-16: para las guías que ya estaban en camino o con
// novedad en la primera lectura (NICK no sabe desde cuándo), se estima con la
// fecha de la orden: 7+ días laborables. SOLO lo ve el admin; nadie más ni avisos.
const ESTIMATE_DAYS = 7;

const due = (since: Date, days: number, now: Date) => addBusinessDays(since, days).getTime() <= now.getTime();
const daysAgo = (d: Date, now: Date) => Math.max(0, Math.floor((now.getTime() - d.getTime()) / 864e5));

// Devuelve, por cada lista, las guías que entran y el motivo en palabras.
export async function getNickAttention(now = new Date(), opts: { estimates?: boolean } = {}): Promise<Record<NickAttentionKey, Map<string, string>>> {
  const out: Record<NickAttentionKey, Map<string, string>> = {
    ESTANCADA: new Map(),
    NOVEDAD_ABIERTA: new Map(),
    DEVOLUCION_NO_LLEGO: new Map(),
    CANCELADA_TRAS_SALIR: new Map(),
    INDEMNIZADA: new Map(),
  };

  // 1 y 2. "statusSince" cuenta desde que NICK vio el estado; para las guías
  // que ya estaban así en la primera lectura empieza a contar desde ese día
  // (así no salen cientos de avisos falsos el primer día).
  const moving = await prisma.nickGuideStatus.findMany({
    where: {
      statusGroup: { in: ["EN_CAMINO", "NOVEDAD"] },
      ...(opts.estimates ? {} : { statusSince: { lte: new Date(now.getTime() - NOVELTY_DAYS * 864e5) } }),
    },
    select: { guideNumber: true, statusGroup: true, status: true, statusSince: true, firstSeenAt: true, orderCreatedAt: true },
  });
  for (const g of moving) {
    const observed = g.statusSince.getTime() > g.firstSeenAt.getTime();
    // Primero el dato real (lo que NICK vio); la estimación solo si todavía no alcanza.
    const since = observed ? "" : " desde que NICK empezó a mirar";
    if (g.statusGroup === "EN_CAMINO" && due(g.statusSince, STUCK_DAYS, now)) {
      out.ESTANCADA.set(g.guideNumber, `${daysAgo(g.statusSince, now)} días sin movimiento${since} («${g.status}»)`);
      continue;
    }
    if (g.statusGroup === "NOVEDAD" && due(g.statusSince, NOVELTY_DAYS, now)) {
      out.NOVEDAD_ABIERTA.set(g.guideNumber, `Novedad hace ${daysAgo(g.statusSince, now)} días${since}`);
      continue;
    }
    if (opts.estimates && !observed && g.orderCreatedAt && due(g.orderCreatedAt, ESTIMATE_DAYS, now)) {
      const why = `Estimado (solo admin): orden de hace ${daysAgo(g.orderCreatedAt, now)} días y sigue «${g.status}»`;
      if (g.statusGroup === "EN_CAMINO") out.ESTANCADA.set(g.guideNumber, why);
      else out.NOVEDAD_ABIERTA.set(g.guideNumber, why);
    }
  }

  // 3. Devolución sin escanear en Reingresos.
  const returns = await prisma.$queryRaw<{ guideNumber: string; statusSince: Date; firstSeenAt: Date; orderCreatedAt: Date | null }[]>`
    SELECT s."guideNumber", s."statusSince", s."firstSeenAt", s."orderCreatedAt"
    FROM "NickGuideStatus" s
    LEFT JOIN "MerchandiseReentryGuide" r ON upper(replace(r."guideNumber", ' ', '')) = s."guideNumber"
    WHERE s."statusGroup" = 'DEVOLUCION' AND r.id IS NULL AND s."orderCreatedAt" >= ${REENTRY_FROM}`;
  for (const g of returns) {
    const seenChange = g.statusSince.getTime() > g.firstSeenAt.getTime();
    if (seenChange) {
      if (due(g.statusSince, RETURN_DAYS, now)) out.DEVOLUCION_NO_LLEGO.set(g.guideNumber, `Devolución hace ${daysAgo(g.statusSince, now)} días, sin escanear`);
    } else if (g.orderCreatedAt && now.getTime() - g.orderCreatedAt.getTime() >= RETURN_FALLBACK_DAYS * 864e5) {
      out.DEVOLUCION_NO_LLEGO.set(g.guideNumber, `Orden de hace ${daysAgo(g.orderCreatedAt, now)} días en devolución, sin escanear`);
    }
  }

  // 4. Cancelada/anulada en Dropi que salió en un corte, sin reporte de guía
  // cancelada ni retención por falta de stock.
  const cancelled = await prisma.$queryRaw<{ guideNumber: string; status: string; manifestDay: string | null }[]>`
    SELECT s."guideNumber", s."status", g."manifestDay"
    FROM "NickGuideStatus" s
    JOIN "FulfillmentRequestGuide" g ON upper(replace(g."guideNumber", ' ', '')) = s."guideNumber"
    LEFT JOIN "CancelledGuideReport" c ON upper(replace(c."guideNumber", ' ', '')) = s."guideNumber"
    LEFT JOIN "FulfillmentGuideHold" h ON upper(replace(h."guideNumber", ' ', '')) = s."guideNumber" AND h."releasedAt" IS NULL
    WHERE s."statusGroup" = 'CANCELADA' AND s."status" NOT ILIKE '%INDEMNIZ%' AND c.id IS NULL AND h.id IS NULL`;
  for (const g of cancelled) out.CANCELADA_TRAS_SALIR.set(g.guideNumber, `«${g.status}» en Dropi; salió en el corte del ${g.manifestDay ?? "?"}`);

  // 5. Indemnizadas.
  const indem = await prisma.nickGuideStatus.findMany({ where: { status: { contains: "INDEMNIZ", mode: "insensitive" } }, select: { guideNumber: true, statusSince: true } });
  for (const g of indem) out.INDEMNIZADA.set(g.guideNumber, "Indemnizada por Dropi: confirmar el pago");

  return out;
}
