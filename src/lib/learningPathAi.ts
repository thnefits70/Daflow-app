import { getAnthropicClient } from "@/lib/nancy";

export const LEARNING_PATH_AI_MODEL = "claude-sonnet-5";

export type GeneratedQuestion = {
  type: "MULTIPLE_CHOICE" | "TRUE_FALSE" | "MATCHING" | "SHORT_ANSWER";
  text: string;
  options: string[];
  matchLeft: string[];
  correctIndex: number | null;
};

export type GenerationResult = {
  questions: GeneratedQuestion[];
  estimatedMinutes: number;
  sampleSize: number;
};

const SYSTEM_PROMPT = `Eres un especialista en capacitación y recursos humanos de DAFLOW (Provedix, Guayaquil, Ecuador). Tu tarea es leer contenido interno de la empresa (documentos, reglamentos, procesos o módulos de inducción) y diseñar un BANCO de preguntas de verificación de aprendizaje — como si armaras el examen de un curso corporativo.

Este banco lo van a responder VARIAS personas distintas de la empresa a lo largo del tiempo. Para que no puedan copiarse las respuestas entre sí (que uno le pase a otro "la pregunta 3 es B"), cada persona ve solo una muestra aleatoria del banco, no el banco completo. Por eso debes generar MÁS preguntas de las que una sola persona respondería en un intento normal — genera aproximadamente el DOBLE.

Reglas para las preguntas:
- Cubre solo la información que un colaborador SÍ o SÍ debe saber, no detalles triviales.
- Piensa primero cuántas preguntas respondería UNA persona en un intento normal ("sampleSize"): para contenido corto (una página o menos), 2-3. Para contenido largo, escala aproximadamente 2 por página (ej. ~10 páginas → sampleSize ~20).
- El banco completo ("questions") debe tener aproximadamente el DOBLE de "sampleSize" preguntas distintas entre sí (no repetidas ni parafraseadas de la misma idea), repartidas a lo largo de todo el contenido, para que la muestra que le toque a cada persona pueda variar de verdad.
- Prioriza SIEMPRE el tipo de pregunta más simple e intuitivo de responder: opción múltiple, verdadero/falso, o unir con líneas (relacionar una columna con otra). Usa "SHORT_ANSWER" (respuesta escrita) únicamente cuando el punto realmente no se pueda reducir a una opción — por ejemplo, pedir que describan un procedimiento con sus propias palabras.
- Las preguntas de opción múltiple llevan 3-4 alternativas plausibles, solo una correcta.
- Las preguntas de verdadero/falso llevan options = ["Verdadero","Falso"].
- Las preguntas de unir con líneas llevan "matchLeft" (columna izquierda) y "options" (columna derecha), del mismo tamaño, donde matchLeft[i] es el par correcto de options[i]. Usa 3-4 pares.
- No inventes información que no esté en el contenido entregado.

Responde ÚNICAMENTE con un objeto JSON (sin texto adicional, sin markdown, sin bloques de código) con esta forma exacta:
{
  "estimatedMinutes": <entero: minutos que le tomaría a UNA persona leer este contenido y responder un intento normal (sampleSize preguntas, no el banco completo), a ritmo normal de lectura más ~1.5 min de reflexión por pregunta>,
  "sampleSize": <entero: cuántas preguntas ve una persona en un intento normal>,
  "questions": [
    {
      "type": "MULTIPLE_CHOICE" | "TRUE_FALSE" | "MATCHING" | "SHORT_ANSWER",
      "text": "...",
      "options": ["..."],
      "matchLeft": ["..."],
      "correctIndex": <entero o null>
    }
  ]
}
Para tipos que no usan un campo, entrega igual el campo con un array vacío ([]) o null, nunca lo omitas.`;

function parseGenerationResponse(raw: string): GenerationResult {
  let text = raw.trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) text = fenced[1].trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("La IA no devolvió un JSON válido.");
  }

  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("questions" in parsed) ||
    !Array.isArray((parsed as { questions: unknown }).questions)
  ) {
    throw new Error("La respuesta de la IA no tiene la forma esperada.");
  }

  const obj = parsed as { questions: unknown[]; estimatedMinutes?: unknown; sampleSize?: unknown };
  const questions: GeneratedQuestion[] = obj.questions.map((q) => {
    const item = q as Record<string, unknown>;
    return {
      type: (item.type as GeneratedQuestion["type"]) ?? "MULTIPLE_CHOICE",
      text: String(item.text ?? ""),
      options: Array.isArray(item.options) ? item.options.map(String) : [],
      matchLeft: Array.isArray(item.matchLeft) ? item.matchLeft.map(String) : [],
      correctIndex: typeof item.correctIndex === "number" ? item.correctIndex : null,
    };
  });

  const sampleSize =
    typeof obj.sampleSize === "number" && obj.sampleSize > 0
      ? Math.min(Math.round(obj.sampleSize), questions.length || 1)
      : Math.max(1, Math.round(questions.length / 2));

  const estimatedMinutes =
    typeof obj.estimatedMinutes === "number" && obj.estimatedMinutes > 0
      ? Math.round(obj.estimatedMinutes)
      : Math.max(5, sampleSize * 4);

  return { questions, estimatedMinutes, sampleSize };
}

export type ContentPart = { type: "text"; text: string } | { type: "pdf"; url: string; label: string };
export type ContentSource = { title: string; parts: ContentPart[] };

// Descarga el PDF y lo pasa como bloque "document" — Claude lo lee directo
// (incluye páginas escaneadas/con imágenes), sin necesitar una librería de
// extracción de texto en el servidor.
async function fetchPdfBase64(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`No se pudo descargar el PDF (${res.status}).`);
  const buf = await res.arrayBuffer();
  return Buffer.from(buf).toString("base64");
}

export async function generateQuestionsForContent(source: ContentSource): Promise<GenerationResult> {
  if (source.parts.length === 0) {
    throw new Error("Este contenido no tiene texto ni PDF adjunto — agrégale contenido antes de generar preguntas.");
  }

  const client = getAnthropicClient();

  const contentBlocks: Array<
    | { type: "text"; text: string }
    | { type: "document"; source: { type: "base64"; media_type: "application/pdf"; data: string } }
  > = [{ type: "text", text: `Contenido: "${source.title}"` }];

  for (const part of source.parts) {
    if (part.type === "pdf") {
      const data = await fetchPdfBase64(part.url);
      contentBlocks.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data } });
    } else {
      contentBlocks.push({ type: "text", text: part.text });
    }
  }
  contentBlocks.push({ type: "text", text: `Genera las preguntas de verificación según las reglas del sistema.` });

  const response = await client.messages.create({
    model: LEARNING_PATH_AI_MODEL,
    max_tokens: 4096,
    system: SYSTEM_PROMPT,
    thinking: { type: "adaptive" },
    output_config: { effort: "medium" },
    messages: [{ role: "user", content: contentBlocks }],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") throw new Error("La IA no devolvió contenido de texto.");

  return parseGenerationResponse(textBlock.text);
}
