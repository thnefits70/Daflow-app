import { prisma } from "@/lib/prisma";
import { normalizeName } from "@/lib/dropiGuidesPdf";
import { findGuideInPdfs, labelClient } from "@/lib/localWarranty";
import { labelMarketData } from "@/lib/guideMarketData";

// Consulta de guías por Michelle (pedido del usuario 2026-10-14): solo el
// dueño de la tienda sabe el número de guía, el nombre de su tienda (como sale
// de remitente) y el nombre de su cliente. Si los tres coinciden con la
// etiqueta del corte, Michelle puede decirle el estado de ESA guía.
//
// Seguridad:
// - La IA nunca ve los datos reales de la etiqueta: solo recibe "coincide" o
//   "no coincide" (y nunca cuál dato falló).
// - El nombre del cliente se lee del PDF solo en este momento para comparar y
//   se descarta: no se guarda (Ley de Protección de Datos, decisión 2026-10-10).
// - 3 intentos fallidos en 24 h → el chat se bloquea 24 horas (role "blocked_24h").
//   Con 1 o 2 fallos Michelle avisa que está a punto de bloquearse.

export const GUIDE_FAIL_LIMIT = 3;

const TRACKING: { match: RegExp; name: string; url: string }[] = [
  {
    match: /SERVI/i,
    name: "Servientrega",
    url: "https://www.servientrega.com.ec/",
  },
  {
    match: /GINTRA/i,
    name: "Gintracom",
    url: "https://ec.gintracom.site/web/site/tracking",
  },
  {
    match: /LAAR/i,
    name: "LaarCourier",
    url: "https://fenixoper.laarcourier.com/Tracking/Guiacompleta.aspx",
  },
  { match: /URBANO/i, name: "Urbano", url: "https://www.urbano.com.ec/" },
  { match: /VELOCES/i, name: "Veloces", url: "https://tracking.veloces.app/" },
];

const words = (s: string | null | undefined) =>
  normalizeName(s ?? "")
    .split(" ")
    .filter((w) => w.length >= 2);

// Nombre del cliente: al menos 2 palabras iguales (nombre + apellido); si la
// etiqueta trae una sola palabra, esa.
function clientMatches(input: string, label: string | null): boolean {
  const a = new Set(words(input));
  const b = words(label);
  if (!b.length || !a.size) return false;
  const hits = b.filter((w) => a.has(w)).length;
  return hits >= Math.min(2, b.length);
}

// Tienda: el nombre que da la persona dentro del remitente (o al revés), o la
// mitad de las palabras del remitente. También vale el nombre de la tienda en
// DAFLOW cuyo remitente es ese (ej. Alonfe = "GUSTAVO URIBE").
function storeMatches(input: string, senders: string[]): boolean {
  const ni = normalizeName(input).replace(/\s+/g, "");
  if (ni.length < 3) return false;
  const a = new Set(words(input));
  return senders.some((s) => {
    const ns = normalizeName(s).replace(/\s+/g, "");
    if (!ns) return false;
    if (ns.includes(ni) || ni.includes(ns)) return true;
    const b = words(s).filter((w) => w.length >= 3);
    return (
      b.length > 0 &&
      b.filter((w) => a.has(w)).length >= Math.ceil(b.length / 2)
    );
  });
}

export type GuideCheckResult =
  | {
      resultado: "verificada";
      estado: "despachada" | "en_preparacion" | "retenida_cancelada";
      transportadora: string;
      fecha_despacho: string | null;
      enlace_rastreo: string | null;
      cancelacion?: string;
    }
  | { resultado: "no_coincide"; intentos_restantes: number }
  | { resultado: "no_encontrada"; intentos_restantes: number }
  | { resultado: "bloquear" };

export type VerifiedGuide = {
  guideNumber: string;
  carrier: string;
  manifestDay: string | null;
  codes: string[];
  batch: {
    source: string;
    fileUrls: string[];
    lot: { day: string; status: string } | null;
  };
};

// Comprueba que quien pregunta es el dueño de la guía (guía + tienda +
// cliente). Cada fallo cuenta para el bloqueo de 24 h. También la usa la
// cancelación de guías por Michelle (michelleCancellations.ts).
export async function verifyGuideOwner(
  input: { guia: string; tienda: string; cliente: string },
  chatId: string,
  who: { visitorId: string; leadId: string | null },
): Promise<
  { ok: true; row: VerifiedGuide } | { ok: false; result: GuideCheckResult }
> {
  const guide = input.guia.replace(/[\s-]/g, "").toUpperCase().slice(0, 30);
  const person = who.leadId
    ? { OR: [{ visitorId: who.visitorId }, { leadId: who.leadId }] }
    : { visitorId: who.visitorId };
  const fails = await prisma.provedixChatMessage.count({
    where: {
      role: "guide_fail",
      createdAt: { gte: new Date(Date.now() - 86_400_000) },
      chat: person,
    },
  });
  if (fails >= GUIDE_FAIL_LIMIT)
    return { ok: false, result: { resultado: "bloquear" } };

  const fail = async (): Promise<{ ok: false; result: GuideCheckResult }> => {
    await prisma.provedixChatMessage.create({
      data: {
        chatId,
        role: "guide_fail",
        content: `Datos de la guía ${guide} no coinciden.`,
      },
    });
    const left = GUIDE_FAIL_LIMIT - fails - 1;
    if (left <= 0) {
      await prisma.provedixChatMessage.create({
        data: {
          chatId,
          role: "blocked_24h",
          content:
            "Falló 3 veces la verificación de guías: chat bloqueado 24 horas.",
        },
      });
      return { ok: false, result: { resultado: "bloquear" } };
    }
    return {
      ok: false,
      result: { resultado: "no_coincide", intentos_restantes: left },
    };
  };

  if (!/^[A-Z0-9]{6,30}$/.test(guide)) return fail();
  const row = await prisma.fulfillmentRequestGuide.findFirst({
    where: { guideNumber: { equals: guide, mode: "insensitive" } },
    select: {
      guideNumber: true,
      carrier: true,
      sender: true,
      manifestDay: true,
      codes: true,
      batch: {
        select: {
          source: true,
          fileUrls: true,
          lot: { select: { day: true, status: true } },
        },
      },
    },
  });
  // Una guía que no existe cuenta como intento fallido: así nadie puede
  // probar números al azar sin límite.
  if (!row) {
    const r = await fail();
    return r.result.resultado === "no_coincide"
      ? {
          ok: false,
          result: {
            resultado: "no_encontrada",
            intentos_restantes: r.result.intentos_restantes,
          },
        }
      : r;
  }

  const { label } = await findGuideInPdfs(row.batch.fileUrls, row.guideNumber);
  if (!label) return fail();
  const clientName = labelClient(label, row.carrier).name;
  const labelStore = labelMarketData(label, row.carrier).store;
  const senders = [row.sender, labelStore].filter((s): s is string => !!s);
  if (senders.length) {
    const stores = await prisma.store.findMany({
      where: { labelSender: { not: null } },
      select: { name: true, labelSender: true },
    });
    for (const s of stores)
      if (s.labelSender && storeMatches(s.labelSender, senders))
        senders.push(s.name);
  }
  if (
    !clientMatches(input.cliente, clientName) ||
    !storeMatches(input.tienda, senders)
  )
    return fail();
  return {
    ok: true,
    row: {
      guideNumber: row.guideNumber,
      carrier: row.carrier,
      manifestDay: row.manifestDay,
      codes: row.codes,
      batch: {
        source: row.batch.source,
        fileUrls: row.batch.fileUrls,
        lot: row.batch.lot,
      },
    },
  };
}

export function trackingFor(carrier: string): {
  name: string;
  url: string | null;
} {
  const t = TRACKING.find((x) => x.match.test(carrier));
  return { name: t?.name ?? carrier, url: t?.url ?? null };
}

// Estado de la cancelación pedida por el chat (si hay), en palabras para la IA.
export const MICHELLE_CANCEL_STATUS_TEXT: Record<string, string> = {
  POR_APROBAR:
    "cancelación pedida fuera de horario: el equipo está revisando si todavía se puede",
  POR_RETENER:
    "cancelación aceptada: el equipo la está buscando para retenerla",
  RETENIDA: "retenida: no salió (hay foto de evidencia)",
  NO_RETENIDA: "no se pudo retener: ya había salido o no se encontró",
  RECHAZADA: "no se pudo cancelar: ya estaba en despacho",
};

export async function checkGuideForDropshipper(
  input: { guia: string; tienda: string; cliente: string },
  chatId: string,
  who: { visitorId: string; leadId: string | null },
): Promise<GuideCheckResult> {
  const v = await verifyGuideOwner(input, chatId, who);
  if (!v.ok) return v.result;
  const row = v.row;
  const carrier = trackingFor(row.carrier);
  const cancelled = await prisma.cancelledGuideReport.findFirst({
    where: { guideNumber: { equals: row.guideNumber, mode: "insensitive" } },
    select: { retainedAt: true, michelleStatus: true },
  });
  const lot = row.batch.lot;
  return {
    resultado: "verificada",
    estado:
      cancelled &&
      cancelled.michelleStatus !== "NO_RETENIDA" &&
      cancelled.michelleStatus !== "RECHAZADA"
        ? "retenida_cancelada"
        : !lot || lot.status === "DRAFT"
          ? "en_preparacion"
          : "despachada",
    transportadora: carrier.name,
    fecha_despacho: row.manifestDay ?? lot?.day ?? null,
    enlace_rastreo: carrier.url,
    ...(cancelled?.michelleStatus
      ? {
          cancelacion:
            MICHELLE_CANCEL_STATUS_TEXT[cancelled.michelleStatus] ??
            cancelled.michelleStatus,
        }
      : {}),
  };
}
