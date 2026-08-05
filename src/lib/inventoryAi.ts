import { getAnthropicClient } from "@/lib/nancy";
import { logAiUsage } from "@/lib/aiUsage";
import { fetchFileContentBlock } from "@/lib/purchaseAi";

const INVENTORY_AI_MODEL = "claude-sonnet-5";

function extractJson<T>(text: string): T {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("La IA no devolvió un JSON reconocible.");
  return JSON.parse(match[0]) as T;
}

export type InventoryValueProofReadResult = { readAmount: number | null };

// Confirmado 2026-08-05: Daniel puede adjuntar una captura de su reporte de
// inventario mostrando el valor total del mes — la IA lee ESE monto y se
// compara contra lo que escribió, mismo patrón que readPaymentProof/
// readPettyCashProof. Solo lee — nunca inventa un valor si no aparece claro.
export async function readInventoryValueProof(params: {
  proofUrl: string;
  actorId: string;
  deptId?: string;
}): Promise<InventoryValueProofReadResult> {
  const client = getAnthropicClient();
  const fileBlock = await fetchFileContentBlock(params.proofUrl);

  const response = await client.messages.create({
    model: INVENTORY_AI_MODEL,
    max_tokens: 512,
    system:
      "Lees capturas de reportes de inventario (ej. \"saldos costeados y valorizados\") para Provedix (Guayaquil, Ecuador). " +
      "Extrae SOLO el valor total del inventario que de verdad muestra la imagen — nunca inventes un valor. " +
      'Responde ÚNICAMENTE un JSON: {"readAmount": number|null}. ' +
      "readAmount es el monto total de inventario (costo total), sin símbolo de moneda. Si no se distingue con claridad cuál es el total, pon null.",
    messages: [
      {
        role: "user",
        content: [
          fileBlock,
          { type: "text", text: "Lee esta captura del reporte de inventario y devuelve el JSON pedido." },
        ],
      },
    ],
  });

  await logAiUsage({
    feature: "control_inventario_comprobante",
    model: INVENTORY_AI_MODEL,
    actorId: params.actorId,
    deptId: params.deptId,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
  });

  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") throw new Error("La IA no devolvió contenido de texto.");
  return extractJson<InventoryValueProofReadResult>(textBlock.text);
}
