// Código único de la compra (SC-XXX). Archivo aparte, sin prisma, para que las
// pantallas del cliente lo importen sin arrastrar la base al bundle.
export function formatPurchaseRequestCode(requestNumber: number): string {
  return `SC-${String(requestNumber).padStart(3, "0")}`;
}
