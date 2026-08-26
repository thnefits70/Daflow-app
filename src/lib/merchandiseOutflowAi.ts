import { getAnthropicClient } from "@/lib/nancy";
import { logAiUsage } from "@/lib/aiUsage";
import { fetchFileContentBlock } from "@/lib/purchaseAi";

const OUTFLOW_AI_MODEL = "claude-sonnet-5";

function extractJson<T>(text: string): T {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("La IA no devolvió un JSON reconocible.");
  return JSON.parse(match[0]) as T;
}

export type OutflowManifestRow = { name: string; quantity: number; confidence: "alta" | "media" | "baja"; catalogMatch: string | null };
export type OutflowManifestReadResult = { rows: OutflowManifestRow[] };

// Confirmado 2026-08-25: Daniel fotografía la hoja física de despacho (o el
// manifiesto de garantía que genera Fulfillment) y la IA arma un consolidado
// editable de producto+cantidad — apoyo para no tener que escribir a mano
// cada renglón, NUNCA se guarda directo: cada fila la confirma Daniel contra
// el catálogo (ProductMatchPicker) antes de quedar en el lote. Mismo
// criterio que readPurchaseQuote: solo extrae lo que de verdad está en la
// imagen, nunca inventa.
//
// Confirmado 2026-08-26: además de leer nombre+cantidad, la misma llamada
// intenta emparejar cada renglón contra el catálogo ya cargado (Just) para
// que Daniel no tenga que buscar cada producto a mano — esto NO es la
// búsqueda por IA que se descartó en Reingreso por costo (esa hacía una
// llamada de reconocimiento por CADA foto); acá es una sola llamada por
// lote que ya se hace de todos modos para leer el documento, solo se le
// pide que además compare contra la lista de nombres. El emparejamiento
// sigue sin ser definitivo: el servidor valida que el nombre devuelto
// exista tal cual en el catálogo antes de confiar en él (ver extract/route.ts),
// y Daniel igual confirma cada fila antes de agregarla al lote.
export async function readOutflowManifest(params: {
  photoUrls: string[];
  documentKind: "despacho" | "garantía";
  catalogNames: string[];
  actorId: string;
  deptId?: string;
}): Promise<OutflowManifestReadResult> {
  const client = getAnthropicClient();
  const fileBlocks = await Promise.all(params.photoUrls.map((u) => fetchFileContentBlock(u)));

  const request = {
    model: OUTFLOW_AI_MODEL,
    max_tokens: 4096,
    system:
      `Lees ${params.documentKind === "despacho" ? "hojas físicas de despacho" : "manifiestos de garantía"} para el ` +
      "área de Inventario de Provedix (Guayaquil, Ecuador). Extrae CADA renglón de producto que aparece, con su " +
      "cantidad — nunca inventes un producto ni una cantidad que no esté escrita. Si el documento trae varias " +
      "fotos (varias hojas o continuación), combina todos los renglones en una sola lista. Si la misma foto " +
      "repite el mismo nombre de producto en más de un renglón, súmalos en una sola fila con la cantidad total. " +
      "También te doy la lista de nombres de productos ya registrados en el catálogo (ver más abajo). Para cada " +
      "renglón, si corresponde con confianza a uno de esa lista — aunque en el papel esté escrito distinto " +
      "(abreviado, mal escrito, en otro orden, con o sin tildes) — copia en \"catalogMatch\" el nombre EXACTO tal " +
      "como aparece en la lista del catálogo, letra por letra. Si dos renglones distintos del documento " +
      "corresponden al mismo producto del catálogo (aunque estén escritos distinto entre sí), igual súmalos en " +
      "una sola fila. Si ningún nombre del catálogo corresponde con confianza real, deja \"catalogMatch\": null — " +
      "nunca fuerces una coincidencia dudosa. " +
      'Responde ÚNICAMENTE un JSON: {"rows": [{"name": string, "quantity": number, "confidence": "alta"|"media"|"baja", "catalogMatch": string|null}]}. ' +
      "name es el nombre del producto tal como está escrito en el documento (no lo traduzcas ni lo normalices). " +
      "quantity es el número de unidades de ese renglón. confidence describe qué tan segura estás de haber leído " +
      "bien ESE renglón puntual: \"alta\" si la letra/número es clara y no da lugar a dudas, \"media\" si hay algo " +
      "que dificulta la lectura (letra manuscrita ambigua, mancha, tachón, foto borrosa o en ángulo) pero igual " +
      "hiciste una lectura razonable, \"baja\" si tuviste que inferir bastante o el renglón es difícil de leer con " +
      "confianza. Si no se distingue con claridad algún renglón, omítelo de la lista en vez de adivinar.",
    messages: [
      {
        role: "user" as const,
        content: [
          ...fileBlocks,
          {
            type: "text" as const,
            text:
              "Catálogo de productos ya registrados (usa estos nombres EXACTOS en \"catalogMatch\" cuando corresponda):\n" +
              params.catalogNames.join("\n"),
          },
          { type: "text" as const, text: "Lee este documento y devuelve el JSON pedido." },
        ],
      },
    ],
  };

  // Con lotes de muchas fotos el modelo, muy rara vez, devuelve una
  // respuesta sin ningún bloque de texto (no es un error de la API, no
  // lanza excepción). Un solo reintento resuelve ese caso sin exponerle
  // el fallo a Daniel.
  let response = await client.messages.create(request);
  let textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    response = await client.messages.create(request);
    textBlock = response.content.find((b) => b.type === "text");
  }

  await logAiUsage({
    feature: "registro_egresos_manifiesto",
    model: OUTFLOW_AI_MODEL,
    actorId: params.actorId,
    deptId: params.deptId,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
  });

  if (!textBlock || textBlock.type !== "text") throw new Error("La IA no devolvió contenido de texto. Intenta de nuevo con menos fotos por lectura.");
  const result = extractJson<OutflowManifestReadResult>(textBlock.text);
  return {
    rows: Array.isArray(result.rows)
      ? result.rows
          .filter((r) => r.name && r.quantity > 0)
          .map((r) => ({
            ...r,
            confidence: r.confidence === "alta" || r.confidence === "media" || r.confidence === "baja" ? r.confidence : "media",
            catalogMatch: typeof r.catalogMatch === "string" && r.catalogMatch.trim() ? r.catalogMatch : null,
          }))
      : [],
  };
}
