import { prisma } from "@/lib/prisma";

// NICK + Servientrega (pedido del usuario 2026-10-17): Dropi no le muestra a
// NICK las guías de garantía (y alguna otra) aunque salgan en los cortes. Para
// no cargar al equipo, DAFLOW consulta sola el rastreo público de Servientrega
// (el mismo que ve cualquiera en servientrega.com.ec) y guarda el estado en
// NICK como cuenta "SERVIENTREGA". Así esas guías entran en Requiere atención,
// Resumen y Score como las demás. Sin cambios en la base.
// - Solo guías de los cortes con transportadora Servientrega que NICK no ve
//   en ninguna cuenta de Dropi (si luego Dropi la muestra, Dropi manda).
// - Cada guía se consulta como mucho cada 2 horas y se deja de consultar
//   cuando se entregó, se anuló o volvió y ya se escaneó en Reingresos.

export const SERVIENTREGA_ACCOUNT = "servientrega";
const TRACK_URL = "https://www.servientrega.com.ec/Tracking/Index/?guia=";
const RECHECK_MS = 2 * 3600 * 1000;
const WINDOW_DAYS = 45;
// Primer corte con números de guía guardados.
const FROM_DAY = "2026-09-21";
// La guía se espera unas horas por si Dropi la muestra (Dropi manda).
const WAIT_DROPI_MS = 3 * 3600 * 1000;

export type ServientregaTrack = {
  status: string;
  group: "PREPARANDO" | "EN_CAMINO" | "NOVEDAD" | "ENTREGADA" | "DEVOLUCION" | "CANCELADA";
  city: string | null;
  createdAt: Date | null;
  lastEventAt: Date | null;
};

const decode = (s: string) =>
  s
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/\s+/g, " ")
    .trim();
// Las horas del rastreo son de Ecuador.
const ecDate = (s: string | undefined) => {
  const m = s?.match(/(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2})/);
  return m ? new Date(`${m[1]}T${m[2]}:00-05:00`) : null;
};

function groupOf(estado: string, events: { title: string; detail: string }[]): ServientregaTrack["group"] {
  const all = `${estado} ${events[0]?.title ?? ""} ${events[0]?.detail ?? ""}`.toUpperCase();
  if (/ANULAD|CANCELAD/.test(all)) return "CANCELADA";
  if (/DEVOLU|DEVUELT|RETORNO/.test(estado.toUpperCase())) return "DEVOLUCION";
  if (/^ENTREGAD/.test(estado.toUpperCase())) return "ENTREGADA";
  if (/NOVEDAD|DIRECCI[OÓ]N|NO ENTREGAD|REZAG|INTENTO|AUSENTE|REHUS/.test(all)) return "NOVEDAD";
  // Solo "Generado": todavía no la recoge Servientrega.
  if (events.length <= 1 && /GENERAD/.test(all)) return "PREPARANDO";
  return "EN_CAMINO";
}

// Lee el rastreo público de una guía. null = Servientrega no la conoce.
export async function trackServientrega(guide: string): Promise<ServientregaTrack | null> {
  const res = await fetch(TRACK_URL + encodeURIComponent(guide), {
    headers: { "User-Agent": "Mozilla/5.0 (DAFLOW)", Accept: "text/html" },
    signal: AbortSignal.timeout(20_000),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Servientrega respondió ${res.status}`);
  const html = await res.text();
  const estado = decode(html.match(/Estado actual:\s*<span>([^<]*)<\/span>/i)?.[1] ?? "");
  const events = [...html.matchAll(/<div class="timeline-content">\s*<h6>([\s\S]*?)<\/h6>\s*<p>([\s\S]*?)<\/p>\s*<p>([\s\S]*?)<\/p>/gi)].map((m) => ({
    title: decode(m[1]),
    at: decode(m[2]),
    detail: decode(m[3]),
  }));
  if (!estado && !events.length) return null;
  const dest = html.match(/Destino\s*:\s*<b>([^<(]*)/i)?.[1];
  // "PENDIENTE" no dice nada: se muestra el último movimiento.
  const status = (/^PENDIENTE$/i.test(estado) && events[0] ? events[0].detail : estado || events[0]?.title || "SIN DATO").toUpperCase().slice(0, 120);
  return {
    status,
    group: groupOf(estado, events),
    city: dest ? decode(dest) || null : null,
    createdAt: ecDate(events[events.length - 1]?.at),
    lastEventAt: ecDate(events[0]?.at),
  };
}

// Guías de los cortes que toca consultar ahora, las más viejas primero.
async function dueGuides(limit: number): Promise<string[]> {
  const since = new Date(Date.now() - WINDOW_DAYS * 864e5).toISOString().slice(0, 10);
  const fromDay = since > FROM_DAY ? since : FROM_DAY;
  const rows = await prisma.$queryRaw<{ guide: string }[]>`
    SELECT upper(replace(g."guideNumber", ' ', '')) guide
    FROM "FulfillmentRequestGuide" g
    LEFT JOIN "NickGuideStatus" s ON s."guideNumber" = upper(replace(g."guideNumber", ' ', ''))
    WHERE g."carrier" ILIKE '%SERVIENTREGA%' AND g."manifestDay" >= ${fromDay}
      AND g."createdAt" < ${new Date(Date.now() - WAIT_DROPI_MS)}
      AND (
        s."guideNumber" IS NULL
        OR (
          s."accountId" = ${SERVIENTREGA_ACCOUNT}
          AND s."lastSeenAt" < ${new Date(Date.now() - RECHECK_MS)}
          AND s."statusGroup" NOT IN ('ENTREGADA', 'CANCELADA')
          AND NOT (s."statusGroup" = 'DEVOLUCION' AND EXISTS (
            SELECT 1 FROM "MerchandiseReentryGuide" r WHERE upper(replace(r."guideNumber", ' ', '')) = s."guideNumber"))
        )
      )
    ORDER BY s."lastSeenAt" ASC NULLS FIRST, g."manifestDay" ASC
    LIMIT ${limit}`;
  return rows.map((r) => r.guide);
}

async function saveTrack(guide: string, t: ServientregaTrack) {
  const now = new Date();
  const prev = await prisma.nickGuideStatus.findUnique({ where: { guideNumber: guide }, select: { status: true, accountId: true } });
  // Si mientras tanto Dropi la mostró, Dropi manda.
  if (prev && prev.accountId !== SERVIENTREGA_ACCOUNT) return;
  // statusSince = hora real del último movimiento en Servientrega.
  const since = t.lastEventAt ?? now;
  const data = {
    status: t.status,
    statusGroup: t.group,
    carrier: "SERVIENTREGA",
    city: t.city,
    rateType: guide.startsWith("745") ? "SIN RECAUDO" : null,
    lastSeenAt: now,
  };
  if (!prev) {
    await prisma.nickGuideStatus.create({
      data: { guideNumber: guide, accountId: SERVIENTREGA_ACCOUNT, dropiOrderId: "", orderCreatedAt: t.createdAt, statusSince: since, firstSeenAt: now, ...data },
    });
    await prisma.nickGuideStatusChange.create({ data: { guideNumber: guide, fromStatus: null, toStatus: t.status, at: now } });
  } else if (prev.status !== t.status) {
    await prisma.nickGuideStatus.update({ where: { guideNumber: guide }, data: { ...data, statusSince: since } });
    await prisma.nickGuideStatusChange.create({ data: { guideNumber: guide, fromStatus: prev.status, toStatus: t.status, at: now } });
  } else {
    await prisma.nickGuideStatus.update({ where: { guideNumber: guide }, data: { lastSeenAt: now } });
  }
}

// Una parte de la lectura (la llama la campanita en horario de trabajo).
// De a 4 guías a la vez para no saturar la página de Servientrega.
export async function runServientregaTick({ budgetMs = 25_000, limit = 40 } = {}) {
  const deadline = Date.now() + budgetMs;
  const guides = await dueGuides(limit);
  let read = 0;
  let failed = 0;
  for (let i = 0; i < guides.length && Date.now() < deadline; i += 4) {
    await Promise.all(
      guides.slice(i, i + 4).map(async (g) => {
        try {
          const t = await trackServientrega(g);
          if (t) {
            await saveTrack(g, t);
            read++;
          } else {
            // Servientrega no la conoce: se marca como vista para no insistir cada minuto.
            await prisma.nickGuideStatus.updateMany({ where: { guideNumber: g, accountId: SERVIENTREGA_ACCOUNT }, data: { lastSeenAt: new Date() } });
          }
        } catch {
          failed++;
        }
      }),
    );
  }
  return { due: guides.length, read, failed };
}
