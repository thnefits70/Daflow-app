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
