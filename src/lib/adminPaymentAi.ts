import { getAnthropicClient } from "@/lib/nancy";
import { logAiUsage } from "@/lib/aiUsage";
import { fetchFileContentBlock } from "@/lib/purchaseAi";

const ADMIN_PAYMENT_AI_MODEL = "claude-sonnet-5";

function extractJson<T>(text: string): T {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("La IA no devolvió un JSON reconocible.");
  return JSON.parse(match[0]) as T;
}

export type AdminPaymentDeclarationResult = {
  readAmount: number | null;
  matches: boolean;
  note: string;
};

// Confirmado 2026-08-06: a diferencia del comprobante de pago (que solo
// necesita el monto), el doc. de soporte opcional (ej. planilla del IESS)
// también debe corresponder al MOTIVO declarado, no solo al monto — así que
// la IA devuelve "matches" explícito en vez de dejar que el llamador solo
// compare un número. Bloqueante: si matches=false, la ruta que llama a esto
// rechaza el envío de la solicitud.
export async function readAdminPaymentDeclaration(params: {
  fileUrl: string;
  expectedAmount: number;
  expectedMotivo: string;
  actorId: string;
}): Promise<AdminPaymentDeclarationResult> {
  const client = getAnthropicClient();
  const fileBlock = await fetchFileContentBlock(params.fileUrl);

  const response = await client.messages.create({
    model: ADMIN_PAYMENT_AI_MODEL,
    max_tokens: 512,
    system:
      "Lees documentos de soporte de pagos administrativos (planillas del IESS, contratos de arriendo, roles, etc.) " +
      "para Provedix (Guayaquil, Ecuador). Extrae SOLO el monto que de verdad muestra el documento — nunca inventes " +
      "un valor. Luego compara ese monto y el concepto general del documento contra lo que declaró la persona que " +
      `pidió el pago: motivo declarado = "${params.expectedMotivo}", monto declarado = ${params.expectedAmount}. ` +
      'Responde ÚNICAMENTE un JSON: {"readAmount": number|null, "matches": boolean, "note": string}. ' +
      "matches es true solo si el monto del documento coincide con el declarado (tolerancia de centavos) Y el " +
      "concepto del documento es consistente con el motivo declarado. note es una frase corta en español explicando " +
      "por qué coincide o no coincide.",
    messages: [
      {
        role: "user",
        content: [
          fileBlock,
          { type: "text", text: "Lee este documento de soporte y devuelve el JSON pedido." },
        ],
      },
    ],
  });

  await logAiUsage({
    feature: "pagos_admin_declaracion",
    model: ADMIN_PAYMENT_AI_MODEL,
    actorId: params.actorId,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
  });

  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") throw new Error("La IA no devolvió contenido de texto.");
  return extractJson<AdminPaymentDeclarationResult>(textBlock.text);
}
