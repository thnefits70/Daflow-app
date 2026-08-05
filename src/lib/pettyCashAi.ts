import { getAnthropicClient } from "@/lib/nancy";
import { logAiUsage } from "@/lib/aiUsage";
import { fetchFileContentBlock } from "@/lib/purchaseAi";

const PETTY_CASH_AI_MODEL = "claude-sonnet-5";

function extractJson<T>(text: string): T {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("La IA no devolvió un JSON reconocible.");
  return JSON.parse(match[0]) as T;
}

export type PettyCashProofReadResult = { readAmount: number | null };

// Lee el comprobante de un movimiento de Caja Chica (desembolso o recarga) —
// UNA vez por movimiento, igual patrón que readPaymentProof de Control de
// Compras. Solo lee el monto; la detección de duplicado exacto va por hash
// (src/lib/fileHash.ts), no por esto.
export async function readPettyCashProof(params: {
  proofUrl: string;
  actorId: string;
  deptId?: string;
}): Promise<PettyCashProofReadResult> {
  const client = getAnthropicClient();
  const fileBlock = await fetchFileContentBlock(params.proofUrl);

  const response = await client.messages.create({
    model: PETTY_CASH_AI_MODEL,
    max_tokens: 512,
    system:
      "Lees comprobantes de Caja Chica (foto de un pago en efectivo, de un retiro, o de alguien recibiendo dinero) para " +
      "Provedix (Guayaquil, Ecuador). Extrae SOLO el monto que de verdad muestra la foto — nunca inventes un valor. " +
      'Responde ÚNICAMENTE un JSON: {"readAmount": number|null}. ' +
      "readAmount es el monto principal que se ve en la foto (sin símbolo de moneda). Si no se distingue con claridad, pon null.",
    messages: [
      {
        role: "user",
        content: [
          fileBlock,
          { type: "text", text: "Lee este comprobante de Caja Chica y devuelve el JSON pedido." },
        ],
      },
    ],
  });

  await logAiUsage({
    feature: "caja_chica_comprobante",
    model: PETTY_CASH_AI_MODEL,
    actorId: params.actorId,
    deptId: params.deptId,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
  });

  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") throw new Error("La IA no devolvió contenido de texto.");
  return extractJson<PettyCashProofReadResult>(textBlock.text);
}
