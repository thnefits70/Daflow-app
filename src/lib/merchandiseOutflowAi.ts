import { getAnthropicClient } from "@/lib/nancy";
import { logAiUsage } from "@/lib/aiUsage";
import { fetchFileContentBlock } from "@/lib/purchaseAi";

const OUTFLOW_AI_MODEL = "claude-sonnet-5";

// Confirmado 2026-08-26: se cambió de "responde solo un JSON" + regex/
// JSON.parse a tool_choice forzado — un nombre de producto con una comilla
// suelta (24" LED, marca entre "comillas", etc.) rompía el JSON de texto
// libre ("Expected ',' or ']' after array element"). Con tool use el SDK
// arma el objeto directamente, sin ese riesgo de escape. Mismo patrón que
// ya usa weeklyCheckin.ts (SUBMIT_WEEKLY_REPORT_TOOL).
const SUBMIT_OUTFLOW_ROWS_TOOL = {
  name: "submit_outflow_rows",
  description: "Registra cada renglón de producto leído del documento de despacho/garantía.",
  input_schema: {
    type: "object" as const,
    properties: {
      rows: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string", description: "Nombre del producto tal como está escrito en el documento, sin traducir ni normalizar." },
            quantity: { type: "number", description: "Número de unidades de ese renglón." },
            code: {
              type: "string",
              description:
                "El código interno del producto (mismo código de Just/Dropi) SOLO si aparece escrito junto a este renglón en el documento — cópialo tal cual, dígitos/letras exactos, sin espacios. Es más confiable que el nombre para identificar el producto exacto. Omite este campo por completo si no hay ningún código visible para este renglón — nunca lo inventes ni lo copies de otro renglón.",
            },
            confidence: {
              type: "string",
              enum: ["alta", "media", "baja"],
              description:
                "'alta' si la letra/número es clara y no da lugar a dudas, 'media' si hay algo que dificulta la lectura pero igual hiciste una lectura razonable, 'baja' si tuviste que inferir bastante.",
            },
            catalogMatch: {
              type: "string",
              description:
                "El nombre EXACTO (letra por letra) de la lista de catálogo dada, SOLO si corresponde con confianza real a este renglón. Omite este campo por completo si ningún nombre del catálogo corresponde con confianza.",
            },
          },
          required: ["name", "quantity", "confidence"],
        },
      },
    },
    required: ["rows"],
  },
};

export type OutflowManifestRow = { name: string; quantity: number; confidence: "alta" | "media" | "baja"; catalogMatch: string | null; code: string | null };
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
      "Algunos documentos traen, junto a cada renglón, el código interno del producto (el mismo código que usa " +
      "Just/Dropi) — si lo ves, transcríbelo en \"code\" tal cual, es la forma MÁS confiable de identificar el " +
      "producto exacto porque no depende de interpretar el nombre a mano. " +
      "También te doy la lista de nombres de productos ya registrados en el catálogo (ver más abajo). Para cada " +
      "renglón, si corresponde con confianza a uno de esa lista — aunque en el papel esté escrito distinto " +
      "(abreviado, mal escrito, en otro orden, con o sin tildes) — copia en \"catalogMatch\" el nombre EXACTO tal " +
      "como aparece en la lista del catálogo, letra por letra. Si dos renglones distintos del documento " +
      "corresponden al mismo producto del catálogo (aunque estén escritos distinto entre sí), igual súmalos en " +
      "una sola fila. Si ningún nombre del catálogo corresponde con confianza real, omite el campo catalogMatch — " +
      "nunca fuerces una coincidencia dudosa. Si no se distingue con claridad algún renglón, omítelo de la lista " +
      "en vez de adivinar. Llama a submit_outflow_rows con el resultado — es la única forma de responder.",
    tools: [SUBMIT_OUTFLOW_ROWS_TOOL],
    tool_choice: { type: "tool" as const, name: "submit_outflow_rows" },
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
          { type: "text" as const, text: "Lee este documento y llama a submit_outflow_rows con el resultado." },
        ],
      },
    ],
  };

  // Con lotes de muchas fotos el modelo, muy rara vez, no llama a la
  // herramienta (no es un error de la API, no lanza excepción). Un solo
  // reintento resuelve ese caso sin exponerle el fallo a Daniel.
  let response = await client.messages.create(request);
  let toolUse = response.content.find((b) => b.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    response = await client.messages.create(request);
    toolUse = response.content.find((b) => b.type === "tool_use");
  }

  await logAiUsage({
    feature: "registro_egresos_manifiesto",
    model: OUTFLOW_AI_MODEL,
    actorId: params.actorId,
    deptId: params.deptId,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
  });

  if (!toolUse || toolUse.type !== "tool_use") throw new Error("La IA no devolvió resultado. Intenta de nuevo con menos fotos por lectura.");
  const result = toolUse.input as OutflowManifestReadResult;
  return {
    rows: Array.isArray(result.rows)
      ? result.rows
          .filter((r) => r.name && r.quantity > 0)
          .map((r) => ({
            ...r,
            confidence: r.confidence === "alta" || r.confidence === "media" || r.confidence === "baja" ? r.confidence : "media",
            catalogMatch: typeof r.catalogMatch === "string" && r.catalogMatch.trim() ? r.catalogMatch : null,
            code: typeof r.code === "string" && r.code.trim() ? r.code.trim() : null,
          }))
      : [],
  };
}
