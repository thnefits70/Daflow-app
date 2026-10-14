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
// - 3 intentos fallidos en 24 h → se cierra el chat y se bloquea (role "blocked").

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
    }
  | { resultado: "no_coincide"; intentos_restantes: number }
  | { resultado: "no_encontrada" }
  | { resultado: "bloquear" };

export async function checkGuideForDropshipper(
  input: { guia: string; tienda: string; cliente: string },
  chatId: string,
  who: { visitorId: string; leadId: string | null },
): Promise<GuideCheckResult> {
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
  if (fails >= GUIDE_FAIL_LIMIT) return { resultado: "bloquear" };

  const fail = async (): Promise<GuideCheckResult> => {
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
          role: "blocked",
          content:
            "Falló 3 veces la verificación de guías: Michelle cerró el chat.",
        },
      });
      return { resultado: "bloquear" };
    }
    return { resultado: "no_coincide", intentos_restantes: left };
  };

  if (!/^[A-Z0-9]{6,30}$/.test(guide)) return fail();
  const row = await prisma.fulfillmentRequestGuide.findFirst({
    where: { guideNumber: { equals: guide, mode: "insensitive" } },
    select: {
      guideNumber: true,
      carrier: true,
      sender: true,
      manifestDay: true,
      batch: {
        select: {
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
    return r.resultado === "no_coincide" ? { resultado: "no_encontrada" } : r;
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

  const carrier = TRACKING.find((t) => t.match.test(row.carrier));
  const cancelled = await prisma.cancelledGuideReport.findFirst({
    where: { guideNumber: { equals: row.guideNumber, mode: "insensitive" } },
    select: { retainedAt: true },
  });
  const lot = row.batch.lot;
  return {
    resultado: "verificada",
    estado: cancelled
      ? "retenida_cancelada"
      : !lot || lot.status === "DRAFT"
        ? "en_preparacion"
        : "despachada",
    transportadora: carrier?.name ?? row.carrier,
    fecha_despacho: row.manifestDay ?? lot?.day ?? null,
    enlace_rastreo: carrier?.url ?? null,
  };
}
