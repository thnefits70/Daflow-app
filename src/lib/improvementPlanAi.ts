import { getAnthropicClient } from "@/lib/nancy";
import { logAiUsage } from "@/lib/aiUsage";
import { SUGGESTED_INDICATORS } from "@/lib/improvementPlanConstants";

const IMPROVEMENT_PLAN_AI_MODEL = "claude-sonnet-5";

function extractJson<T>(text: string): T {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("La IA no devolvió un JSON reconocible.");
  return JSON.parse(match[0]) as T;
}

export type ImprovementPlanDraft = {
  situacion: string;
  resultadoEsperado: string;
  commitments: { indicador: string; meta: string; responsable: "COLABORADOR" | "LIDER" }[];
};

// Confirmado 2026-09-10: la IA solo asiste al LÍDER a redactar — nunca
// escribe directo a la base de datos ni le sugiere nada al colaborador (ver
// docblock de ImprovementPlan en schema.prisma). El líder siempre revisa y
// confirma/edita este borrador antes de que exista un plan de verdad.
export async function draftImprovementPlan(params: { freeText: string; actorId: string }): Promise<ImprovementPlanDraft> {
  const client = getAnthropicClient();

  const response = await client.messages.create({
    model: IMPROVEMENT_PLAN_AI_MODEL,
    max_tokens: 1024,
    system:
      "Ayudas a un líder de equipo en Provedix (Guayaquil, Ecuador) a redactar el BORRADOR de un Plan de Mejora y Acompañamiento formal para un colaborador de su equipo. " +
      "Es un documento de Recursos Humanos serio — nunca inventes detalles, nombres, cifras ni hechos que el líder no haya mencionado. " +
      "Si el líder no dio suficiente información para algún campo, escribe algo breve y genérico basado solo en lo que sí dijo, nunca lo inventes de la nada. " +
      "Esto es SOLO UN BORRADOR: el líder lo va a revisar y editar antes de que el plan exista de verdad, así que prioriza fidelidad a lo que escribió por sobre completar huecos. " +
      "Debes proponer entre 1 y 3 compromisos concretos y medibles (indicador a mejorar + meta específica), y decidir si cada uno depende principalmente del colaborador o de apoyo del líder. " +
      'Responde ÚNICAMENTE un JSON: {"situacion": string, "resultadoEsperado": string, "commitments": [{"indicador": string, "meta": string, "responsable": "COLABORADOR"|"LIDER"}]}. ' +
      "situacion describe qué está pasando hoy (el problema observado). resultadoEsperado describe qué se espera lograr con el plan. " +
      `Si te sirve como referencia, estos son los indicadores típicos que se evalúan después en el seguimiento semanal: ${SUGGESTED_INDICATORS.join(", ")} — pero los compromisos del plan no tienen que limitarse a esa lista.`,
    messages: [{ role: "user", content: params.freeText }],
  });

  await logAiUsage({
    feature: "plan_mejora_redaccion",
    model: IMPROVEMENT_PLAN_AI_MODEL,
    actorId: params.actorId,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
  });

  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") throw new Error("La IA no devolvió contenido de texto.");
  const draft = extractJson<ImprovementPlanDraft>(textBlock.text);
  return {
    situacion: draft.situacion ?? "",
    resultadoEsperado: draft.resultadoEsperado ?? "",
    commitments: (draft.commitments ?? []).slice(0, 3).map((c) => ({
      indicador: c.indicador ?? "",
      meta: c.meta ?? "",
      responsable: c.responsable === "LIDER" ? "LIDER" : "COLABORADOR",
    })),
  };
}

export type WeeklyReviewDraft = {
  scores: Record<string, number>;
  queMejoro: string;
  queFalta: string;
  accionSiguiente: string;
  apoyoLider: string;
};

// Mismo espíritu que draftImprovementPlan: borrador editable para la
// evaluación semanal, nunca visible para el colaborador (ver punto 6 del
// diseño de la feature — la IA nunca le sugiere nada directo a él).
export async function draftWeeklyReview(params: {
  freeText: string;
  actorId: string;
  indicators: string[];
}): Promise<WeeklyReviewDraft> {
  const client = getAnthropicClient();

  const response = await client.messages.create({
    model: IMPROVEMENT_PLAN_AI_MODEL,
    max_tokens: 1024,
    system:
      "Ayudas a un líder de equipo en Provedix (Guayaquil, Ecuador) a redactar el BORRADOR de la evaluación semanal de un Plan de Mejora y Acompañamiento. " +
      "Es un documento serio de seguimiento de desempeño — nunca inventes hechos, cifras o calificaciones que no se desprendan de lo que el líder escribió. " +
      "Esto es SOLO UN BORRADOR: el líder lo revisa y edita antes de guardarlo de verdad. " +
      `Los indicadores disponibles para calificar esta semana son: ${params.indicators.join(", ")}. ` +
      "Califica de 1 a 5 SOLO los indicadores que el texto del líder realmente toca (no tienes que calificarlos todos — típicamente entre 4 y 8 de ellos, nunca todos si el texto no da para tanto). " +
      'Responde ÚNICAMENTE un JSON: {"scores": {"<indicador>": number, ...}, "queMejoro": string, "queFalta": string, "accionSiguiente": string, "apoyoLider": string}. ' +
      "Las claves de scores deben ser EXACTAMENTE el texto de los indicadores de la lista de arriba, tal cual, sin inventar indicadores nuevos. " +
      "queMejoro: qué mejoró esta semana. queFalta: qué sigue faltando. accionSiguiente: qué se hará la próxima semana. apoyoLider: qué apoyo dará el líder.",
    messages: [{ role: "user", content: params.freeText }],
  });

  await logAiUsage({
    feature: "plan_mejora_evaluacion_semanal",
    model: IMPROVEMENT_PLAN_AI_MODEL,
    actorId: params.actorId,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
  });

  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") throw new Error("La IA no devolvió contenido de texto.");
  const draft = extractJson<WeeklyReviewDraft>(textBlock.text);
  const validIndicators = new Set(params.indicators);
  const scores: Record<string, number> = {};
  for (const [key, value] of Object.entries(draft.scores ?? {})) {
    if (!validIndicators.has(key)) continue;
    const n = Number(value);
    if (Number.isFinite(n)) scores[key] = Math.max(1, Math.min(5, Math.round(n)));
  }
  return {
    scores,
    queMejoro: draft.queMejoro ?? "",
    queFalta: draft.queFalta ?? "",
    accionSiguiente: draft.accionSiguiente ?? "",
    apoyoLider: draft.apoyoLider ?? "",
  };
}
