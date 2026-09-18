import { getAnthropicClient } from "@/lib/nancy";
import { logAiUsage } from "@/lib/aiUsage";
import { fetchFileContentBlock } from "@/lib/purchaseAi";

const EXTERNAL_SALE_PROOF_AI_MODEL = "claude-sonnet-5";

function extractJson<T>(text: string): T {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("La IA no devolvió un JSON reconocible.");
  return JSON.parse(match[0]) as T;
}

export type ExternalSaleProofReadResult = { readAmount: number | null };

// Confirmado 2026-09-18, pedido explícito del usuario: lee el comprobante
// que sube el asesor por el pago de una venta externa (transferencia
// bancaria del cliente, o wallet a wallet Dropi) — mismo patrón que
// readPettyCashProof (pettyCashAi.ts), pero acá interesa cuánto le llegó a
// la cuenta de la empresa, no cuánto le costó al cliente enviarlo, así que
// la comisión bancaria (si aparece aparte) NO se suma.
export async function readExternalSalePaymentProof(params: {
  proofUrl: string;
  actorId: string;
  deptId?: string;
}): Promise<ExternalSaleProofReadResult> {
  const client = getAnthropicClient();
  const fileBlock = await fetchFileContentBlock(params.proofUrl);

  const response = await client.messages.create({
    model: EXTERNAL_SALE_PROOF_AI_MODEL,
    max_tokens: 512,
    system:
      "Lees comprobantes de pago de un cliente por una venta externa (transferencia bancaria, o wallet a wallet Dropi) para " +
      "Provedix (Guayaquil, Ecuador). Extrae SOLO el monto que de verdad muestra la foto — nunca inventes un valor. " +
      "Si la foto es una factura o nota de venta con varias líneas de dinero (subtotal, descuento, IVA/impuestos, propina, total), " +
      "usa SIEMPRE el TOTAL final transferido/recibido — nunca el subtotal ni ningún monto parcial. " +
      "Si es un comprobante de TRANSFERENCIA BANCARIA que además muestra por separado un 'Costo de transacción' y/o 'IVA' " +
      "(la comisión que le cobró el banco al cliente por hacer la transferencia), NO la sumes al monto — acá interesa " +
      "cuánto le llegó de verdad a la cuenta de la empresa, no cuánto le costó al cliente enviarlo (a diferencia de un " +
      "comprobante de Caja Chica). " +
      'Responde ÚNICAMENTE un JSON: {"readAmount": number|null}. ' +
      "readAmount es ese monto final (sin símbolo de moneda). Si no se distingue con claridad, pon null.",
    messages: [
      {
        role: "user",
        content: [
          fileBlock,
          { type: "text", text: "Lee este comprobante de pago de una venta externa y devuelve el JSON pedido." },
        ],
      },
    ],
  });

  await logAiUsage({
    feature: "ventas_externas_comprobante",
    model: EXTERNAL_SALE_PROOF_AI_MODEL,
    actorId: params.actorId,
    deptId: params.deptId,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
  });

  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") throw new Error("La IA no devolvió contenido de texto.");
  return extractJson<ExternalSaleProofReadResult>(textBlock.text);
}
