// Confirmado 2026-09-30, pedido explícito del usuario: mercadería de CHEN
// comprada antes de trabajar con DAFLOW/INVESTOCK nunca va a tener una
// compra registrada que respalde el reclamo de deterioro. Jariel la marca
// con un clic (purchase-pre-daflow/route.ts) en vez de escribir y esperar
// que admin autorice. Esta nota identifica esos casos en pantalla.
export const PRE_DAFLOW_NOTE = "Comprado antes de DAFLOW";

export function isPreDaflowClaim(item: { purchaseNoMatchNote?: string | null; purchaseExceptionDecision?: string | null }) {
  return item.purchaseExceptionDecision === "AUTHORIZED" && item.purchaseNoMatchNote === PRE_DAFLOW_NOTE;
}
