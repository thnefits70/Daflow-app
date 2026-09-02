// Constantes livianas, sin dependencias de servidor — seguras de importar
// tanto desde componentes cliente como desde lib de servidor.
export const CARRIER_LABELS: Record<string, string> = {
  SERVIENTREGA: "Servientrega",
  URBANO: "Urbano",
  GINTRANCOM: "Gintrancom",
  LAARCOURIER: "Laarcourier",
  VELOCES: "Veloces",
};

export const SOURCE_AREA_LABELS: Record<string, string> = {
  MKT_DAMIAN: "Análisis de Mercado — Bodega Importadora Damián",
  MKT_PROVEDIX: "Análisis de Mercado — Bodega Provedix",
  FULFILLMENT: "Fulfillment",
};

export const MKT_CANCEL_REASONS = ["Solicitud del dropshipper", "Falta de stock"];
export const FULFILLMENT_CANCEL_REASONS = ["No cumple medidas o peso"];

// Prefijo y largo total (en caracteres) del número de guía de cada
// transportadora. Con esto se puede cortar automáticamente un texto donde
// varias guías se escanean/tipean seguidas, sin espacio entre una y otra.
// Ordenados de más a menos específico: los prefijos alfabéticos van antes
// que "18" (Servientrega), que es puramente numérico y más genérico.
export const CARRIER_GUIDE_FORMATS: { carrier: keyof typeof CARRIER_LABELS; prefix: string; length: number }[] = [
  { carrier: "LAARCOURIER", prefix: "LC", length: 10 },
  { carrier: "URBANO", prefix: "WYB", length: 12 },
  { carrier: "VELOCES", prefix: "V400", length: 11 },
  { carrier: "GINTRANCOM", prefix: "D00", length: 10 },
  { carrier: "SERVIENTREGA", prefix: "18", length: 9 },
];

// Extrae del buffer todas las guías completas que ya se puedan reconocer
// (prefijo conocido + largo alcanzado), en orden. Lo que sobra (una guía
// todavía a medio tipear) queda en `remainder`.
export function splitGuideBuffer(raw: string): {
  extracted: { carrier: keyof typeof CARRIER_LABELS; guideNumber: string }[];
  remainder: string;
} {
  let buf = raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const extracted: { carrier: keyof typeof CARRIER_LABELS; guideNumber: string }[] = [];
  for (;;) {
    const match = CARRIER_GUIDE_FORMATS.find((f) => buf.startsWith(f.prefix));
    if (!match || buf.length < match.length) break;
    extracted.push({ carrier: match.carrier, guideNumber: buf.slice(0, match.length) });
    buf = buf.slice(match.length);
  }
  return { extracted, remainder: buf };
}

// true si lo tipeado hasta ahora todavía podría llegar a matchear alguna
// transportadora conocida (aunque falten caracteres); false si ya no calza
// con ninguna, para avisar de un número raro.
export function isPossibleGuidePrefix(buf: string): boolean {
  if (!buf) return true;
  return CARRIER_GUIDE_FORMATS.some((f) => f.prefix.startsWith(buf) || buf.startsWith(f.prefix));
}
