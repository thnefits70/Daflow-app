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

// Prefijos con los que empieza el número de guía de cada transportadora.
// Ordenados de más a menos específico: los prefijos alfabéticos van antes
// que "18" (Servientrega), que es puramente numérico y más genérico.
const CARRIER_PREFIXES: [string, keyof typeof CARRIER_LABELS][] = [
  ["LC", "LAARCOURIER"],
  ["WYB", "URBANO"],
  ["V400", "VELOCES"],
  ["D00", "GINTRANCOM"],
  ["18", "SERVIENTREGA"],
];

export function detectCarrierFromGuideNumber(guideNumber: string): keyof typeof CARRIER_LABELS | null {
  const normalized = guideNumber.trim().toUpperCase();
  if (!normalized) return null;
  for (const [prefix, carrier] of CARRIER_PREFIXES) {
    if (normalized.startsWith(prefix)) return carrier;
  }
  return null;
}
