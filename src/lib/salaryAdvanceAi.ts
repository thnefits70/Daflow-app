import { getAnthropicClient } from "@/lib/nancy";
import { logAiUsage } from "@/lib/aiUsage";
import { fetchFileContentBlock } from "@/lib/purchaseAi";

const SALARY_ADVANCE_AI_MODEL = "claude-sonnet-5";

function extractJson<T>(text: string): T {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("La IA no devolvió un JSON reconocible.");
  return JSON.parse(match[0]) as T;
}

export type SalaryAdvanceProofReadResult = { readAmount: number | null };

// Mismo patrón que readPettyCashProof: lee el monto de la transferencia del
// anticipo antes de que admin confirme "Aprobar y transferir".
export async function readSalaryAdvanceProof(params: {
  proofUrl: string;
  actorId: string;
  deptId?: string;
}): Promise<SalaryAdvanceProofReadResult> {
  const client = getAnthropicClient();
  const fileBlock = await fetchFileContentBlock(params.proofUrl);

  const response = await client.messages.create({
    model: SALARY_ADVANCE_AI_MODEL,
    max_tokens: 512,
    system:
      "Lees comprobantes de transferencia bancaria de un anticipo de sueldo para Provedix (Guayaquil, Ecuador). " +
      "Extrae SOLO el monto que de verdad muestra la foto — nunca inventes un valor. " +
      'Responde ÚNICAMENTE un JSON: {"readAmount": number|null}. ' +
      "readAmount es el monto transferido que se ve en el comprobante (sin símbolo de moneda). Si no se distingue con claridad, pon null.",
    messages: [
      {
        role: "user",
        content: [
          fileBlock,
          { type: "text", text: "Lee este comprobante de transferencia y devuelve el JSON pedido." },
        ],
      },
    ],
  });

  await logAiUsage({
    feature: "anticipos_comprobante",
    model: SALARY_ADVANCE_AI_MODEL,
    actorId: params.actorId,
    deptId: params.deptId,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
  });

  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") throw new Error("La IA no devolvió contenido de texto.");
  return extractJson<SalaryAdvanceProofReadResult>(textBlock.text);
}
