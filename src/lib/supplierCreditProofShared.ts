// Tipos y reglas de revisión del comprobante de crédito de proveedor que
// también usa el navegador (ver supplierCreditProof.ts para la parte de
// servidor: IA, firma, duplicados).

export type CreditProofClaim = { id: string; catalogItemId: string | null; name: string; justCode: string | null; quantity: number; expectedCredit: number | null };

export type CreditProofLine = {
  code: string | null;
  description: string;
  quantity: number | null;
  amount: number | null;
  claimId: string | null;
  // "memoria" = lo reconoció un código ya confirmado antes para este
  // proveedor; "ia" = lo emparejó la IA por nombre/cantidad/monto.
  matchedBy: "memoria" | "ia" | null;
};

export type CreditProofRead = {
  supplierNameOnDoc: string | null;
  supplierMatches: "si" | "no" | "no_se_ve";
  docDate: string | null;
  total: number | null;
  lines: CreditProofLine[];
  notes: string | null;
};

export function normalizeSupplierCode(code: string): string {
  return code.trim().toUpperCase().replace(/\s+/g, "");
}

export type CreditDuplicateWarning = { creditId: string; createdAt: string; amount: number; reason: string; kind: "misma_imagen" | "mismo_credito" };

// Mismas reglas se muestran en pantalla (antes de confirmar) y se vuelven a
// calcular en el servidor al guardar — si hay alguna, Jariel tiene que
// explicar la diferencia y se le avisa a admin.
export function computeCreditProofWarnings(params: {
  read: CreditProofRead | null;
  supplierName: string;
  selectedClaims: { id: string; name: string }[];
  amount: number;
  duplicates: CreditDuplicateWarning[];
}): string[] {
  const w: string[] = [];
  const { read } = params;
  if (!read) {
    w.push("La IA no pudo leer el comprobante — nadie revisó que cuadre.");
  } else {
    if (read.supplierMatches === "no") w.push(`El comprobante parece de otro proveedor${read.supplierNameOnDoc ? ` (${read.supplierNameOnDoc})` : ""}, no de ${params.supplierName}.`);
    if (read.total != null && Math.abs(read.total - params.amount) > 0.01) w.push(`El comprobante dice $${read.total.toFixed(2)} y se está registrando $${params.amount.toFixed(2)}.`);
    if (read.total == null) w.push("El comprobante no muestra un total claro.");
    const inDoc = new Set(read.lines.map((l) => l.claimId).filter(Boolean));
    const missing = params.selectedClaims.filter((c) => !inDoc.has(c.id));
    if (missing.length) w.push(`El comprobante no menciona: ${missing.map((c) => c.name).join(", ")}.`);
    const selectedIds = new Set(params.selectedClaims.map((c) => c.id));
    const extra = read.lines.filter((l) => !l.claimId || !selectedIds.has(l.claimId));
    if (extra.length) w.push(`El comprobante trae renglones que no están marcados: ${extra.map((l) => l.code ?? l.description).join(", ")}.`);
  }
  for (const d of params.duplicates) {
    w.push(
      d.kind === "misma_imagen"
        ? `Esta misma imagen ya se usó en otro crédito ($${d.amount.toFixed(2)} — ${d.reason}).`
        : `Parece el mismo crédito que ya se registró ($${d.amount.toFixed(2)} — ${d.reason}).`,
    );
  }
  return w;
}
