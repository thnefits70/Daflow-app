// Tipos y reglas de la revisión de capturas de acuerdos con el proveedor
// que también usa el navegador (ver claimProofCheck.ts para la parte de
// servidor: IA, firma, huella de la imagen).
//
// Confirmado 2026-09-29, pedido del usuario: la captura que se sube en
// "No se paga (se descuenta en la tanda)" / "Crédito futuro" (reporte
// urgente) y en "Corregir precio" ya no se acepta a ciegas: la IA la lee UNA
// vez y se revisa que sea del proveedor, del mismo producto y que diga lo
// que se está registrando. Si algo no cuadra NO se bloquea — quien la sube
// escribe la explicación y el admin la ve en rojo (mismo criterio "avisar +
// nota" que eligió el usuario para los créditos de deterioro).

export type ClaimProofKind = "no_envio" | "precio";

export type YesNoUnclear = "si" | "no" | "no_se_ve";

export type ClaimProofRead = {
  isChatOrDoc: YesNoUnclear;
  supplierNameOnDoc: string | null;
  supplierMatches: YesNoUnclear;
  productMatches: YesNoUnclear;
  quantityOnDoc: number | null;
  // Solo "no_envio": ¿el proveedor acepta que no manda / no cobra esas unidades?
  statesAgreement: YesNoUnclear;
  // Solo "precio": precio por unidad que aparece como acordado.
  unitPriceOnDoc: number | null;
  docDate: string | null;
  notes: string | null;
};

export type ClaimProofDuplicate = { where: string; createdAt: string };

export type ClaimProofContext = {
  kind: ClaimProofKind;
  supplierName: string;
  productName: string;
  quantity: number;
  newUnitCost?: number | null;
};

export function computeClaimProofWarnings(read: ClaimProofRead | null, ctx: ClaimProofContext, duplicates: ClaimProofDuplicate[]): string[] {
  const w: string[] = [];
  if (!read) {
    w.push("La IA no pudo leer la captura — nadie revisó que diga lo que se está registrando.");
  } else {
    if (read.isChatOrDoc === "no") w.push("La imagen no parece un chat ni un documento con el proveedor.");
    if (read.supplierMatches === "no") w.push(`La captura parece de otro proveedor${read.supplierNameOnDoc ? ` (${read.supplierNameOnDoc})` : ""}, no de ${ctx.supplierName}.`);
    if (read.productMatches === "no") w.push(`La captura no habla de ${ctx.productName}.`);
    if (ctx.kind === "no_envio") {
      if (read.statesAgreement !== "si") {
        w.push(read.statesAgreement === "no"
          ? "La captura NO dice que el proveedor no va a mandar o no va a cobrar esas unidades."
          : "No se ve claro que el proveedor acepte no mandar o no cobrar esas unidades.");
      }
      if (read.quantityOnDoc != null && read.quantityOnDoc !== ctx.quantity) w.push(`La captura dice ${read.quantityOnDoc} un. y se están registrando ${ctx.quantity}.`);
    } else {
      if (read.unitPriceOnDoc == null) w.push("La captura no muestra el precio acordado.");
      else if (ctx.newUnitCost != null && Math.abs(read.unitPriceOnDoc - ctx.newUnitCost) > 0.005) {
        w.push(`La captura dice $${read.unitPriceOnDoc.toFixed(2)} por unidad y se está pidiendo $${ctx.newUnitCost.toFixed(2)}.`);
      }
    }
  }
  for (const d of duplicates) w.push(`Esta misma imagen ya se usó antes (${d.where}).`);
  return w;
}
