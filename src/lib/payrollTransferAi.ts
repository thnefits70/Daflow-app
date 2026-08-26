import { getAnthropicClient } from "@/lib/nancy";
import { logAiUsage, type AiUsageFeature } from "@/lib/aiUsage";
import { fetchFileContentBlock } from "@/lib/purchaseAi";

const PAYROLL_TRANSFER_AI_MODEL = "claude-sonnet-5";

function extractJson<T>(text: string): T {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("La IA no devolvió un JSON reconocible.");
  return JSON.parse(match[0]) as T;
}

export type PayrollTransferProofReadResult = { readAmount: number | null };

async function readTransferProofAmount(params: {
  proofUrl: string;
  actorId: string;
  feature: AiUsageFeature;
}): Promise<PayrollTransferProofReadResult> {
  const client = getAnthropicClient();
  const fileBlock = await fetchFileContentBlock(params.proofUrl);

  const response = await client.messages.create({
    model: PAYROLL_TRANSFER_AI_MODEL,
    max_tokens: 512,
    system:
      "Lees comprobantes de transferencia bancaria de nómina para Provedix (Guayaquil, Ecuador). " +
      "Extrae SOLO el monto que de verdad muestra la foto — nunca inventes un valor. " +
      'Responde ÚNICAMENTE un JSON: {"readAmount": number|null}. ' +
      "readAmount es el monto transferido que se ve en el comprobante (sin símbolo de moneda). Si no se distingue con claridad, pon null.",
    messages: [
      {
        role: "user",
        content: [
          fileBlock,
          { type: "text", text: "Lee este comprobante de transferencia y devolvé el JSON pedido." },
        ],
      },
    ],
  });

  await logAiUsage({
    feature: params.feature,
    model: PAYROLL_TRANSFER_AI_MODEL,
    actorId: params.actorId,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
  });

  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") throw new Error("La IA no devolvió contenido de texto.");
  return extractJson<PayrollTransferProofReadResult>(textBlock.text);
}

// Mismo patrón que readSalaryAdvanceProof/readPettyCashProof: lee el monto
// del comprobante de la transferencia de nómina antes de que el admin
// confirme "Confirmar transferencia hecha", para poder cambiar la foto a
// tiempo si no coincide con el total que Nairoby envió.
export async function readPayrollTransferProof(params: { proofUrl: string; actorId: string }): Promise<PayrollTransferProofReadResult> {
  return readTransferProofAmount({ ...params, feature: "nomina_transferencia_comprobante" });
}

// Mismo lector, pero para el pago individual a UN colaborador ya con el
// total en poder de Nairoby (o de la cuenta que corresponda) — se compara
// contra el netTotal de ese rol puntual, no contra el total de la quincena.
export async function readIndividualPayrollProof(params: { proofUrl: string; actorId: string }): Promise<PayrollTransferProofReadResult> {
  return readTransferProofAmount({ ...params, feature: "nomina_pago_individual_comprobante" });
}

// Mismo lector, para el total aparte de IESS retenido de todos los
// colaboradores (ver totalIessFromRoles en payroll.ts) — comparado contra
// PayrollIessTransfer.totalAmount, nunca contra el total de nómina.
export async function readIessTransferProof(params: { proofUrl: string; actorId: string }): Promise<PayrollTransferProofReadResult> {
  return readTransferProofAmount({ ...params, feature: "nomina_iess_comprobante" });
}
