// Constantes livianas, sin dependencias de servidor (Prisma/etc.) — seguras
// de importar tanto desde componentes cliente como desde lib de servidor.
export const OUTFLOW_REASON_LABELS: Record<string, string> = {
  DESPACHO: "Despacho",
  GARANTIA: "Garantía",
  DETERIORO: "Deterioro",
  COMPRA_PERSONAL: "Compra personal",
  CAMBIO_PROVEEDOR: "Cambio con proveedor",
};
