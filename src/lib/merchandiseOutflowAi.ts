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
                "El código interno del producto (mismo código de Just/Dropi) SOLO si aparece escrito junto a este renglón en el documento — cópialo tal cual, dígitos/letras exactos, sin espacios. Omite este campo por completo si no hay ningún código visible para este renglón — nunca lo inventes ni lo copies de otro renglón.",
            },
            confidence: {
              type: "string",
              enum: ["alta", "media", "baja"],
              description:
                "'alta' si la letra/número es clara y no da lugar a dudas, 'media' si hay algo que dificulta la lectura pero igual hiciste una lectura razonable, 'baja' si tuviste que inferir bastante.",
            },
          },
          required: ["name", "quantity", "confidence"],
        },
      },
    },
    required: ["rows"],
  },
};

export type OutflowManifestRow = { name: string; quantity: number; confidence: "alta" | "media" | "baja"; code: string | null; catalogMatch: string | null };
export type OutflowManifestReadResult = { rows: Omit<OutflowManifestRow, "catalogMatch">[] };

// Confirmado 2026-08-25: Daniel fotografía la hoja física de despacho (o el
// manifiesto de garantía que genera Fulfillment) y la IA arma un consolidado
// editable de producto+cantidad — apoyo para no tener que escribir a mano
// cada renglón, NUNCA se guarda directo: cada fila la confirma Daniel contra
// el catálogo (ProductMatchPicker) antes de quedar en el lote. Mismo
// criterio que readPurchaseQuote: solo extrae lo que de verdad está en la
// imagen, nunca inventa.
//
// Confirmado 2026-08-26, corregido el mismo día: esta llamada SOLO lee el
// documento (nombre/cantidad/código) — el emparejamiento contra el
// catálogo se separó a matchOutflowNamesToCatalog (llamada aparte, solo
// texto, sin fotos). Daniel reportó más errores de lectura (cantidades y
// nombres) justo después de meter la lista completa del catálogo (444
// productos) y las instrucciones de emparejamiento en esta misma llamada
// — la hipótesis es que ese contexto extra le restaba precisión a la
// tarea de transcripción sobre las fotos. Mantener esta llamada enfocada
// únicamente en "qué dice el papel".
export async function readOutflowManifest(params: { photoUrls: string[]; documentKind: "despacho" | "garantía"; actorId: string; deptId?: string }): Promise<OutflowManifestReadResult> {
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
      "Just/Dropi) — si lo ves, transcríbelo en \"code\" tal cual, sin mezclarlo con el nombre ni con el código de " +
      "otro renglón. Si no se distingue con claridad algún renglón, omítelo de la lista en vez de adivinar. Llama " +
      "a submit_outflow_rows con el resultado — es la única forma de responder.",
    tools: [SUBMIT_OUTFLOW_ROWS_TOOL],
    tool_choice: { type: "tool" as const, name: "submit_outflow_rows" },
    messages: [{ role: "user" as const, content: [...fileBlocks, { type: "text" as const, text: "Lee este documento y llama a submit_outflow_rows con el resultado." }] }],
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
            code: typeof r.code === "string" && r.code.trim() ? r.code.trim() : null,
          }))
      : [],
  };
}

const SUBMIT_CATALOG_MATCHES_TOOL = {
  name: "submit_catalog_matches",
  description: "Devuelve, para los nombres que sí corresponden con confianza real a un producto del catálogo, el índice y el nombre exacto del catálogo.",
  input_schema: {
    type: "object" as const,
    properties: {
      matches: {
        type: "array",
        items: {
          type: "object",
          properties: {
            index: { type: "number", description: "Índice (0-based) del nombre en la lista dada que sí tiene una coincidencia confiable." },
            catalogMatch: { type: "string", description: "Nombre EXACTO tal como aparece en la lista del catálogo, letra por letra." },
          },
          required: ["index", "catalogMatch"],
        },
      },
    },
    required: ["matches"],
  },
};

// Confirmado 2026-08-26: separado de readOutflowManifest a propósito — esta
// llamada es SOLO texto (sin fotos), así que el tamaño de la lista de
// catálogo no compite por atención con la lectura de la imagen. No es la
// búsqueda por IA que se descartó en Reingreso por costo (esa hacía un
// reconocimiento por CADA foto); esta es una sola llamada de texto por
// lote, sobre lo que ya se leyó. El servidor valida el nombre devuelto
// contra el catálogo real antes de confiar en él (ver extract/route.ts) —
// Daniel igual confirma cada fila antes de agregarla al lote.
export async function matchOutflowNamesToCatalog(params: { names: string[]; catalogNames: string[]; actorId: string; deptId?: string }): Promise<(string | null)[]> {
  if (params.names.length === 0) return [];
  const client = getAnthropicClient();

  const request = {
    model: OUTFLOW_AI_MODEL,
    max_tokens: 2048,
    system:
      "Recibes nombres de producto leídos de un documento físico (pueden venir abreviados, mal escritos, en otro " +
      "orden, con o sin tildes) y una lista de nombres ya registrados en un catálogo. Para cada nombre que " +
      "corresponda CON CONFIANZA REAL a uno del catálogo, indica su índice y el nombre EXACTO del catálogo. Omite " +
      "los que no tengan una coincidencia confiable — nunca fuerces una coincidencia dudosa, es preferible dejar " +
      "uno sin emparejar que emparejarlo mal. Llama a submit_catalog_matches con el resultado.",
    tools: [SUBMIT_CATALOG_MATCHES_TOOL],
    tool_choice: { type: "tool" as const, name: "submit_catalog_matches" },
    messages: [
      {
        role: "user" as const,
        content: [
          { type: "text" as const, text: "Nombres leídos del documento:\n" + params.names.map((n, i) => `${i}: ${n}`).join("\n") },
          { type: "text" as const, text: "Catálogo:\n" + params.catalogNames.join("\n") },
        ],
      },
    ],
  };

  try {
    const response = await client.messages.create(request);
    const toolUse = response.content.find((b) => b.type === "tool_use");
    await logAiUsage({
      feature: "registro_egresos_catalogo_match",
      model: OUTFLOW_AI_MODEL,
      actorId: params.actorId,
      deptId: params.deptId,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    });
    if (!toolUse || toolUse.type !== "tool_use") return params.names.map(() => null);

    const result = toolUse.input as { matches?: { index: number; catalogMatch: string }[] };
    const out: (string | null)[] = params.names.map(() => null);
    for (const m of result.matches ?? []) {
      if (typeof m.index === "number" && m.index >= 0 && m.index < out.length && typeof m.catalogMatch === "string" && m.catalogMatch.trim()) {
        out[m.index] = m.catalogMatch.trim();
      }
    }
    return out;
  } catch {
    // El emparejamiento por nombre es apoyo, no crítico — si esta llamada
    // falla, Daniel simplemente busca esos productos a mano, igual que
    // antes de que existiera esta función.
    return params.names.map(() => null);
  }
}
