import crypto from "crypto";
import { getAnthropicClient } from "@/lib/nancy";
import { logAiUsage } from "@/lib/aiUsage";
import { fetchFileContentBlock } from "@/lib/purchaseAi";
import { prisma } from "@/lib/prisma";
import { normalizeSupplierCode, type CreditProofClaim, type CreditProofLine, type CreditProofRead, type CreditDuplicateWarning } from "@/lib/supplierCreditProofShared";

export * from "@/lib/supplierCreditProofShared";

const CREDIT_PROOF_AI_MODEL = "claude-sonnet-5";

// Confirmado 2026-09-23, pedido explícito del usuario (Jariel con Zheng wu):
// cuando el proveedor acepta dar crédito por uno o varios reclamos de
// deterioro escalado, Jariel sube la captura/documento donde lo acepta y la
// IA lo lee UNA sola vez por comprobante (no una por producto — ver
// feedback de costo de IA). Lee proveedor, renglones (código del proveedor,
// descripción, cantidad, monto) y total, y en la MISMA llamada empareja cada
// renglón contra los reclamos pendientes de ese proveedor. Los códigos que
// Jariel ya confirmó antes para ese proveedor (SupplierProductCode) se
// aplican en código DESPUÉS, por encima de lo que diga la IA — lo
// memorizado manda. Nada se guarda solo: Jariel revisa y confirma.

const SUBMIT_CREDIT_PROOF_TOOL = {
  name: "submit_credit_proof",
  description: "Registra lo que dice el comprobante de crédito del proveedor.",
  input_schema: {
    type: "object" as const,
    properties: {
      supplierNameOnDoc: { type: "string", description: "Nombre del proveedor tal como aparece en el comprobante (nombre del chat, membrete, firma). Omite si no aparece." },
      supplierMatches: {
        type: "string",
        enum: ["si", "no", "no_se_ve"],
        description: "'si' si el comprobante es claramente del proveedor esperado, 'no' si claramente es de OTRO proveedor, 'no_se_ve' si no se puede saber por la imagen.",
      },
      docDate: { type: "string", description: "Fecha del comprobante en formato AAAA-MM-DD si aparece. Omite si no aparece." },
      total: { type: "number", description: "Total del crédito que el proveedor acepta, en dólares. Omite si no aparece un total ni se puede sumar con seguridad." },
      lines: {
        type: "array",
        items: {
          type: "object",
          properties: {
            code: { type: "string", description: "Código del producto tal como lo escribe el proveedor, SOLO si aparece. Nunca lo inventes." },
            description: { type: "string", description: "Cómo el proveedor nombra el producto en el comprobante, sin traducir." },
            quantity: { type: "number", description: "Unidades, si aparecen." },
            amount: { type: "number", description: "Monto de crédito de este renglón en dólares, si aparece." },
            claimId: { type: "string", description: "El id del reclamo pendiente que corresponde a este renglón, SOLO si estás razonablemente seguro. Omite si ninguno encaja." },
          },
          required: ["description"],
        },
      },
      notes: { type: "string", description: "Cualquier cosa rara que convenga saber (captura cortada, montos tachados, moneda distinta). Omite si no hay nada." },
    },
    required: ["supplierMatches", "lines"],
  },
};

export async function readSupplierCreditProof(params: {
  proofUrl: string;
  supplierName: string;
  claims: CreditProofClaim[];
  knownCodes: { code: string; catalogItemId: string; productName: string }[];
  actorId: string;
}): Promise<CreditProofRead> {
  const client = getAnthropicClient();
  const fileBlock = await fetchFileContentBlock(params.proofUrl);

  const claimsText = params.claims
    .map((c) => `- id=${c.id} · ${c.name}${c.justCode ? ` (nuestro código ${c.justCode})` : ""} · ${c.quantity} un.${c.expectedCredit != null ? ` · crédito estimado $${c.expectedCredit.toFixed(2)}` : ""}`)
    .join("\n");
  const codesText = params.knownCodes.length ? params.knownCodes.map((k) => `- ${k.code} = ${k.productName}`).join("\n") : "(ninguno todavía)";

  const request = {
    model: CREDIT_PROOF_AI_MODEL,
    max_tokens: 2048,
    system:
      "Lees comprobantes (capturas de chat, notas de crédito, documentos) donde un proveedor acepta darle crédito a " +
      "Provedix (Guayaquil, Ecuador) por mercadería que llegó dañada. Extrae SOLO lo que de verdad está escrito — " +
      "nunca inventes un producto, código, cantidad o monto. Los proveedores casi nunca usan nuestros códigos: " +
      "suelen escribir su propio código o el nombre del producto a su manera. Empareja cada renglón con un reclamo " +
      "pendiente por nombre, cantidad y monto; si no estás razonablemente seguro, deja claimId vacío. Un mismo " +
      "reclamo PUEDE ocupar varios renglones (el proveedor a veces separa variantes, colores o modelos del mismo " +
      "producto con códigos distintos) — en ese caso usa el mismo claimId en cada renglón y la suma de cantidades " +
      "debe acercarse a las unidades del reclamo. Llama a submit_credit_proof con el resultado — es la única forma de responder.",
    tools: [SUBMIT_CREDIT_PROOF_TOOL],
    tool_choice: { type: "tool" as const, name: "submit_credit_proof" },
    messages: [
      {
        role: "user" as const,
        content: [
          fileBlock,
          {
            type: "text" as const,
            text:
              `Proveedor esperado: ${params.supplierName}\n\n` +
              `Reclamos pendientes con este proveedor:\n${claimsText}\n\n` +
              `Códigos de este proveedor que ya conocemos:\n${codesText}\n\n` +
              "Lee el comprobante y llama a submit_credit_proof.",
          },
        ],
      },
    ],
  };

  let response = await client.messages.create(request);
  let toolUse = response.content.find((b) => b.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    response = await client.messages.create(request);
    toolUse = response.content.find((b) => b.type === "tool_use");
  }

  await logAiUsage({
    feature: "deterioro_credito_comprobante",
    model: CREDIT_PROOF_AI_MODEL,
    actorId: params.actorId,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
  });

  if (!toolUse || toolUse.type !== "tool_use") throw new Error("La IA no devolvió resultado. Intenta de nuevo.");
  const raw = toolUse.input as {
    supplierNameOnDoc?: string;
    supplierMatches?: string;
    docDate?: string;
    total?: number;
    lines?: { code?: string; description?: string; quantity?: number; amount?: number; claimId?: string }[];
    notes?: string;
  };

  const validClaimIds = new Set(params.claims.map((c) => c.id));
  const claimByCatalogItem = new Map(params.claims.filter((c) => c.catalogItemId).map((c) => [c.catalogItemId!, c.id]));
  const knownByCode = new Map(params.knownCodes.map((k) => [normalizeSupplierCode(k.code), k.catalogItemId]));
  const num = (n: unknown) => (typeof n === "number" && Number.isFinite(n) ? n : null);

  const lines: CreditProofLine[] = (Array.isArray(raw.lines) ? raw.lines : []).map((l) => {
    const code = typeof l.code === "string" && l.code.trim() ? normalizeSupplierCode(l.code) : null;
    // Lo memorizado manda por encima de la IA.
    const memorized = code ? knownByCode.get(code) : undefined;
    const memorizedClaim = memorized ? claimByCatalogItem.get(memorized) ?? null : null;
    const aiClaim = typeof l.claimId === "string" && validClaimIds.has(l.claimId) ? l.claimId : null;
    // Si el código ya es conocido pero ese producto no está entre los
    // reclamos pendientes, no se le cree a la IA que sea otro.
    const claimId = memorized ? memorizedClaim : aiClaim;
    return {
      code,
      description: typeof l.description === "string" ? l.description : "",
      quantity: num(l.quantity),
      amount: num(l.amount),
      claimId,
      matchedBy: memorizedClaim ? "memoria" : aiClaim ? "ia" : null,
    };
  });
  return {
    supplierNameOnDoc: typeof raw.supplierNameOnDoc === "string" && raw.supplierNameOnDoc.trim() ? raw.supplierNameOnDoc.trim() : null,
    supplierMatches: raw.supplierMatches === "si" || raw.supplierMatches === "no" ? raw.supplierMatches : "no_se_ve",
    docDate: typeof raw.docDate === "string" && raw.docDate.trim() ? raw.docDate.trim() : null,
    total: num(raw.total),
    lines,
    notes: typeof raw.notes === "string" && raw.notes.trim() ? raw.notes.trim() : null,
  };
}

// La lectura de la IA viaja al navegador y vuelve al confirmar — se firma
// para que el aviso a admin se base en lo que la IA de verdad leyó, no en
// algo editado en el camino (mismo patrón HMAC con AUTH_SECRET que ya se usa
// en otras partes de la app).
export function signCreditProofRead(read: CreditProofRead, proofUrl: string): string {
  return crypto.createHmac("sha256", process.env.AUTH_SECRET ?? "").update(`${proofUrl}|${JSON.stringify(read)}`).digest("hex");
}

export function verifyCreditProofRead(read: CreditProofRead, proofUrl: string, signature: string): boolean {
  const expected = signCreditProofRead(read, proofUrl);
  return expected.length === signature.length && crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}

export async function hashProofFile(url: string): Promise<string | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return crypto.createHash("sha256").update(Buffer.from(await res.arrayBuffer())).digest("hex");
  } catch {
    return null;
  }
}

// Nunca bloquea por código de producto (se repite en créditos futuros, ver
// SupplierProductCode) — solo avisa si es la MISMA imagen ya usada, o si ya
// hay un crédito de este proveedor con el mismo monto y algún mismo
// producto en los últimos 60 días. Aviso, no bloqueo: Jariel explica y sigue.
export async function findPossibleDuplicateCredits(params: { supplierId: string; proofHash: string | null; amount: number | null; catalogItemIds: string[] }): Promise<CreditDuplicateWarning[]> {
  const out: CreditDuplicateWarning[] = [];
  const seen = new Set<string>();
  if (params.proofHash) {
    const same = await prisma.supplierCredit.findMany({ where: { proofHash: params.proofHash }, select: { id: true, createdAt: true, amount: true, reason: true } });
    for (const c of same) {
      seen.add(c.id);
      out.push({ creditId: c.id, createdAt: c.createdAt.toISOString(), amount: c.amount, reason: c.reason, kind: "misma_imagen" });
    }
  }
  if (params.amount != null && params.catalogItemIds.length > 0) {
    const since = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
    const similar = await prisma.supplierCredit.findMany({
      where: {
        supplierId: params.supplierId,
        createdAt: { gte: since },
        amount: { gte: params.amount - 0.01, lte: params.amount + 0.01 },
        OR: [
          { outflowItem: { catalogItemId: { in: params.catalogItemIds } } },
          { groupedOutflowItems: { some: { catalogItemId: { in: params.catalogItemIds } } } },
        ],
      },
      select: { id: true, createdAt: true, amount: true, reason: true },
    });
    for (const c of similar) {
      if (seen.has(c.id)) continue;
      out.push({ creditId: c.id, createdAt: c.createdAt.toISOString(), amount: c.amount, reason: c.reason, kind: "mismo_credito" });
    }
  }
  return out;
}

// Reclamos de deterioro escalado de este proveedor que ya se pueden cerrar
// con crédito — mismas condiciones que purchase-resolve/route.ts (anclado a
// una compra real, o admin autorizó seguir sin respaldo).
export async function loadCreditableClaims(supplierId: string): Promise<CreditProofClaim[]> {
  const items = await prisma.merchandiseOutflowItem.findMany({
    where: {
      purchaseGestionSupplierId: supplierId,
      resolution: "ESCALATED_TO_PURCHASES",
      purchaseResolution: null,
      batch: { reason: "DETERIORO" },
      OR: [{ linkedPurchaseRequestId: { not: null } }, { purchaseExceptionDecision: "AUTHORIZED" }],
    },
    include: { catalogItem: { select: { name: true, justCode: true } } },
    orderBy: { resolvedAt: "asc" },
  });
  return items.map((i) => ({
    id: i.id,
    catalogItemId: i.catalogItemId,
    name: i.catalogItem?.name ?? i.declaredName,
    justCode: i.catalogItem?.justCode ?? null,
    quantity: i.quantity,
    expectedCredit: i.expectedCreditAmount,
  }));
}
