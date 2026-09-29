import crypto from "crypto";
import { getAnthropicClient } from "@/lib/nancy";
import { logAiUsage } from "@/lib/aiUsage";
import { fetchFileContentBlock } from "@/lib/purchaseAi";
import { prisma } from "@/lib/prisma";
import { hashProofFile } from "@/lib/supplierCreditProof";
import { computeClaimProofWarnings, type ClaimProofContext, type ClaimProofDuplicate, type ClaimProofRead, type YesNoUnclear } from "@/lib/claimProofCheckShared";

export * from "@/lib/claimProofCheckShared";
export { hashProofFile };

const CLAIM_PROOF_AI_MODEL = "claude-sonnet-5";

// Ver claimProofCheckShared.ts. UNA sola lectura de IA por captura subida
// (casos de pocos por semana) — nunca una por producto ni por pantalla.

const SUBMIT_TOOL = {
  name: "submit_claim_proof",
  description: "Registra lo que muestra la captura del acuerdo con el proveedor.",
  input_schema: {
    type: "object" as const,
    properties: {
      isChatOrDoc: { type: "string", enum: ["si", "no", "no_se_ve"], description: "'si' si es una captura de chat, correo o documento con un proveedor; 'no' si es cualquier otra cosa (foto de producto, meme, pantalla sin relación)." },
      supplierNameOnDoc: { type: "string", description: "Nombre del proveedor/contacto tal como aparece (nombre del chat, firma, membrete). Omite si no aparece." },
      supplierMatches: { type: "string", enum: ["si", "no", "no_se_ve"], description: "'si' si claramente es el proveedor esperado, 'no' si claramente es OTRO, 'no_se_ve' si no se puede saber." },
      productMatches: { type: "string", enum: ["si", "no", "no_se_ve"], description: "'si' si se habla del producto esperado (puede estar escrito a su manera, en otro idioma o con foto), 'no' si claramente es otro producto, 'no_se_ve' si no se menciona ningún producto." },
      quantityOnDoc: { type: "number", description: "Unidades que menciona el acuerdo, SOLO si aparecen. Nunca las inventes." },
      statesAgreement: { type: "string", enum: ["si", "no", "no_se_ve"], description: "SOLO para tipo no_envio: 'si' si el proveedor dice que no va a mandar esas unidades (se le acabó el stock, no tiene, no enviará) o que no las cobra / da crédito o descuento por ellas; 'no' si dice lo contrario (sí las va a mandar); 'no_se_ve' si no está claro. Para tipo precio, 'no_se_ve'." },
      unitPriceOnDoc: { type: "number", description: "SOLO para tipo precio: precio por unidad acordado en dólares, SOLO si aparece escrito. Si hay varios precios, el último que ambos aceptan." },
      docDate: { type: "string", description: "Fecha visible en formato AAAA-MM-DD. Omite si no aparece." },
      notes: { type: "string", description: "Algo raro que convenga saber (captura cortada, parece editada, moneda distinta, texto en otro idioma resumido en español). Omite si no hay nada." },
    },
    required: ["isChatOrDoc", "supplierMatches", "productMatches", "statesAgreement"],
  },
};

export async function readClaimProof(params: ClaimProofContext & { proofUrl: string; actorId: string }): Promise<ClaimProofRead> {
  const client = getAnthropicClient();
  const fileBlock = await fetchFileContentBlock(params.proofUrl);
  const what =
    params.kind === "no_envio"
      ? `Tipo: no_envio. Se va a registrar que el proveedor NO manda (o no cobra) ${params.quantity} un. de "${params.productName}" — por ejemplo porque se le acabó el stock. La captura debería mostrar que el proveedor lo acepta.`
      : `Tipo: precio. Se va a registrar que el precio acordado de "${params.productName}" (${params.quantity} un.) es $${(params.newUnitCost ?? 0).toFixed(2)} por unidad. La captura debería mostrar ese acuerdo de precio.`;

  const request = {
    model: CLAIM_PROOF_AI_MODEL,
    max_tokens: 1024,
    system:
      "Revisas capturas (chats de WhatsApp/WeChat, correos, documentos) que el equipo de compras de Provedix " +
      "(Guayaquil, Ecuador) sube como prueba de un acuerdo con un proveedor. Los proveedores suelen ser chinos: " +
      "pueden escribir en chino, inglés o español, y nombrar el producto a su manera o con una foto. Reporta SOLO " +
      "lo que de verdad se ve — nunca inventes cantidades, precios ni nombres. Llama a submit_claim_proof con el " +
      "resultado — es la única forma de responder.",
    tools: [SUBMIT_TOOL],
    tool_choice: { type: "tool" as const, name: "submit_claim_proof" },
    messages: [
      {
        role: "user" as const,
        content: [
          fileBlock,
          { type: "text" as const, text: `Proveedor esperado: ${params.supplierName}\n${what}\n\nRevisa la captura y llama a submit_claim_proof.` },
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
    feature: params.kind === "no_envio" ? "compras_captura_no_envio" : "compras_captura_precio",
    model: CLAIM_PROOF_AI_MODEL,
    actorId: params.actorId,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
  });
  if (!toolUse || toolUse.type !== "tool_use") throw new Error("La IA no devolvió resultado. Intenta de nuevo.");

  const raw = toolUse.input as Record<string, unknown>;
  const yn = (v: unknown): YesNoUnclear => (v === "si" || v === "no" ? v : "no_se_ve");
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  return {
    isChatOrDoc: yn(raw.isChatOrDoc),
    supplierNameOnDoc: str(raw.supplierNameOnDoc),
    supplierMatches: yn(raw.supplierMatches),
    productMatches: yn(raw.productMatches),
    quantityOnDoc: num(raw.quantityOnDoc),
    statesAgreement: params.kind === "no_envio" ? yn(raw.statesAgreement) : "no_se_ve",
    unitPriceOnDoc: params.kind === "precio" ? num(raw.unitPriceOnDoc) : null,
    docDate: str(raw.docDate),
    notes: str(raw.notes),
  };
}

// La lectura viaja al navegador y vuelve al guardar — se firma (mismo
// patrón HMAC que supplierCreditProof.ts) para que lo que ve el admin sea
// lo que la IA de verdad leyó. `null` = la IA falló (también se firma).
export function signClaimProofRead(read: ClaimProofRead | null, proofUrl: string, scope: string): string {
  return crypto.createHmac("sha256", process.env.AUTH_SECRET ?? "").update(`claim|${scope}|${proofUrl}|${JSON.stringify(read)}`).digest("hex");
}

export function verifyClaimProofRead(read: ClaimProofRead | null, proofUrl: string, scope: string, signature: string): boolean {
  const expected = signClaimProofRead(read, proofUrl, scope);
  return expected.length === signature.length && crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}

// La misma imagen ya usada como prueba en un crédito/"no se paga" o en una
// corrección de precio (cualquier proveedor) — solo aviso, nunca bloqueo.
export async function findClaimProofDuplicates(proofHash: string | null): Promise<ClaimProofDuplicate[]> {
  if (!proofHash) return [];
  const [credits, corrections] = await Promise.all([
    prisma.supplierCredit.findMany({ where: { proofHash }, select: { reason: true, createdAt: true }, take: 5 }),
    prisma.purchasePriceCorrection.findMany({
      where: { proofHash },
      select: { requestedAt: true, request: { select: { catalogItem: { select: { name: true } } } } },
      take: 5,
    }),
  ]);
  return [
    ...credits.map((c) => ({ where: c.reason, createdAt: c.createdAt.toISOString() })),
    ...corrections.map((c) => ({ where: `corrección de precio de ${c.request.catalogItem.name}`, createdAt: c.requestedAt.toISOString() })),
  ];
}

// Contexto real (desde la base, nunca desde el navegador) de lo que se
// quiere registrar — lo usan tanto la lectura como el guardado.
export async function loadClaimProofContext(params: { kind: "no_envio"; reportId: string; quantity: number } | { kind: "precio"; requestId: string; newUnitCost: number }): Promise<ClaimProofContext | null> {
  if (params.kind === "no_envio") {
    const report = await prisma.purchaseRequestUrgentReport.findUnique({
      where: { id: params.reportId },
      select: { request: { select: { catalogItem: { select: { name: true } }, supplier: { select: { name: true } } } } },
    });
    if (!report) return null;
    return { kind: "no_envio", supplierName: report.request.supplier.name, productName: report.request.catalogItem.name, quantity: params.quantity };
  }
  const request = await prisma.purchaseRequest.findUnique({
    where: { id: params.requestId },
    select: { quantity: true, catalogItem: { select: { name: true } }, supplier: { select: { name: true } } },
  });
  if (!request) return null;
  return { kind: "precio", supplierName: request.supplier.name, productName: request.catalogItem.name, quantity: request.quantity, newUnitCost: params.newUnitCost };
}

// Qué se estaba registrando cuando se leyó — va dentro de la firma, así una
// lectura hecha para 10 un. o $10 no sirve para guardar 200 un. o $8.
export function claimProofScope(p: { kind: "no_envio"; reportId: string; quantity: number } | { kind: "precio"; requestId: string; newUnitCost: number }): string {
  return p.kind === "no_envio" ? `no_envio:${p.reportId}:${p.quantity}` : `precio:${p.requestId}:${p.newUnitCost.toFixed(4)}`;
}

export type ClaimProofSaveInput = { read?: unknown; signature?: string; mismatchNote?: string };

// Al guardar: la lectura tiene que venir firmada para ESTO mismo que se está
// registrando; los avisos se recalculan acá (nunca se confía en los del
// navegador) y, si hay alguno, la explicación es obligatoria.
export async function checkClaimProofForSave(params: {
  target: { kind: "no_envio"; reportId: string; quantity: number } | { kind: "precio"; requestId: string; newUnitCost: number };
  proofUrl: string;
  input: ClaimProofSaveInput;
}): Promise<{ ok: true; proofHash: string | null; read: ClaimProofRead | null; warnings: string[]; mismatchNote: string | null } | { ok: false; error: string }> {
  const { input } = params;
  if (!input.signature || input.read === undefined) return { ok: false, error: "Falta que la IA revise la captura. Vuelve a subirla." };
  const read = (input.read ?? null) as ClaimProofRead | null;
  if (!verifyClaimProofRead(read, params.proofUrl, claimProofScope(params.target), input.signature)) {
    return { ok: false, error: "Cambió la cantidad o el precio después de revisar la captura. Vuelve a revisarla." };
  }
  const ctx = await loadClaimProofContext(params.target);
  if (!ctx) return { ok: false, error: "No encontrado." };
  const proofHash = await hashProofFile(params.proofUrl);
  const warnings = computeClaimProofWarnings(read, ctx, await findClaimProofDuplicates(proofHash));
  const note = input.mismatchNote?.trim() ?? "";
  if (warnings.length > 0 && !note) return { ok: false, error: "La captura no cuadra del todo — explica por qué antes de guardar." };
  return { ok: true, proofHash, read, warnings, mismatchNote: warnings.length > 0 ? `${warnings.join(" ")}\nExplicación: ${note}` : null };
}
