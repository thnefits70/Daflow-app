import { getAnthropicClient } from "@/lib/nancy";
import { logAiUsage } from "@/lib/aiUsage";
import { fetchFileContentBlock } from "@/lib/purchaseAi";

const OUTFLOW_AI_MODEL = "claude-sonnet-5";

function extractJson<T>(text: string): T {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("La IA no devolvió un JSON reconocible.");
  return JSON.parse(match[0]) as T;
}

export type OutflowManifestRow = { name: string; quantity: number; confidence: "alta" | "media" | "baja" };
export type OutflowManifestReadResult = { rows: OutflowManifestRow[] };

// Confirmado 2026-08-25: Daniel fotografía la hoja física de despacho (o el
// manifiesto de garantía que genera Fulfillment) y la IA arma un consolidado
// editable de producto+cantidad — apoyo para no tener que escribir a mano
// cada renglón, NUNCA se guarda directo: cada fila la confirma Daniel contra
// el catálogo (ProductMatchPicker) antes de quedar en el lote. Mismo
// criterio que readPurchaseQuote: solo extrae lo que de verdad está en la
// imagen, nunca inventa.
export async function readOutflowManifest(params: { photoUrls: string[]; documentKind: "despacho" | "garantía"; actorId: string; deptId?: string }): Promise<OutflowManifestReadResult> {
  const client = getAnthropicClient();
  const fileBlocks = await Promise.all(params.photoUrls.map((u) => fetchFileContentBlock(u)));

  const response = await client.messages.create({
    model: OUTFLOW_AI_MODEL,
    max_tokens: 2048,
    system:
      `Lees ${params.documentKind === "despacho" ? "hojas físicas de despacho" : "manifiestos de garantía"} para el ` +
      "área de Inventario de Provedix (Guayaquil, Ecuador). Extrae CADA renglón de producto que aparece, con su " +
      "cantidad — nunca inventes un producto ni una cantidad que no esté escrita. Si el documento trae varias " +
      "fotos (varias hojas o continuación), combina todos los renglones en una sola lista. Si la misma foto " +
      "repite el mismo nombre de producto en más de un renglón, súmalos en una sola fila con la cantidad total. " +
      'Responde ÚNICAMENTE un JSON: {"rows": [{"name": string, "quantity": number, "confidence": "alta"|"media"|"baja"}]}. ' +
      "name es el nombre del producto tal como está escrito en el documento (no lo traduzcas ni lo normalices). " +
      "quantity es el número de unidades de ese renglón. confidence describe qué tan segura estás de haber leído " +
      "bien ESE renglón puntual: \"alta\" si la letra/número es clara y no da lugar a dudas, \"media\" si hay algo " +
      "que dificulta la lectura (letra manuscrita ambigua, mancha, tachón, foto borrosa o en ángulo) pero igual " +
      "hiciste una lectura razonable, \"baja\" si tuviste que inferir bastante o el renglón es difícil de leer con " +
      "confianza. Si no se distingue con claridad algún renglón, omítelo de la lista en vez de adivinar.",
    messages: [
      {
        role: "user",
        content: [...fileBlocks, { type: "text", text: "Lee este documento y devuelve el JSON pedido." }],
      },
    ],
  });

  await logAiUsage({
    feature: "registro_egresos_manifiesto",
    model: OUTFLOW_AI_MODEL,
    actorId: params.actorId,
    deptId: params.deptId,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
  });

  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") throw new Error("La IA no devolvió contenido de texto.");
  const result = extractJson<OutflowManifestReadResult>(textBlock.text);
  return {
    rows: Array.isArray(result.rows)
      ? result.rows
          .filter((r) => r.name && r.quantity > 0)
          .map((r) => ({ ...r, confidence: r.confidence === "alta" || r.confidence === "media" || r.confidence === "baja" ? r.confidence : "media" }))
      : [],
  };
}
