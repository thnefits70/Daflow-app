import type Anthropic from "@anthropic-ai/sdk";
import { getAnthropicClient } from "@/lib/nancy";
import { logAiUsage, type AiUsageFeature } from "@/lib/aiUsage";
import { SUGGESTED_INDICATORS } from "@/lib/improvementPlanConstants";

const IMPROVEMENT_PLAN_AI_MODEL = "claude-sonnet-5";

// Confirmado 2026-09-14: se cambió de "responde solo un JSON" + regex/
// JSON.parse a tool_choice forzado, mismo motivo y mismo patrón que ya usan
// merchandiseOutflowAi.ts/weeklyCheckin.ts — un texto libre con comillas
// rompía el JSON ("Expected ',' or ']' after array element"), y en raras
// ocasiones el modelo devolvía la respuesta sin ningún bloque de texto. Con
// tool use el SDK arma el objeto directamente; se reintenta una sola vez si
// el modelo no llama a la herramienta.
async function requestToolInput<T>(params: {
  client: ReturnType<typeof getAnthropicClient>;
  system: string;
  userText: string;
  tool: Anthropic.Tool;
  feature: AiUsageFeature;
  actorId: string;
}): Promise<T> {
  const request = {
    model: IMPROVEMENT_PLAN_AI_MODEL,
    max_tokens: 1024,
    system: params.system,
    tools: [params.tool],
    tool_choice: { type: "tool" as const, name: params.tool.name },
    messages: [{ role: "user" as const, content: params.userText }],
  };

  for (let attempt = 1; attempt <= 2; attempt++) {
    const response = await params.client.messages.create(request);

    await logAiUsage({
      feature: params.feature,
      model: IMPROVEMENT_PLAN_AI_MODEL,
      actorId: params.actorId,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    });

    const toolUse = response.content.find((b) => b.type === "tool_use");
    if (toolUse && toolUse.type === "tool_use") return toolUse.input as T;
  }
  throw new Error("La IA no devolvió una respuesta utilizable.");
}

export type ImprovementPlanDraft = {
  situacion: string;
  resultadoEsperado: string;
  commitments: { indicador: string; meta: string; responsable: "COLABORADOR" | "LIDER" }[];
};

const SUBMIT_IMPROVEMENT_PLAN_TOOL = {
  name: "submit_improvement_plan",
  description: "Registra el borrador del Plan de Mejora y Acompañamiento redactado a partir de lo que escribió el líder.",
  input_schema: {
    type: "object" as const,
    properties: {
      situacion: { type: "string", description: "Qué está pasando hoy (el problema observado), basado solo en lo que escribió el líder." },
      resultadoEsperado: { type: "string", description: "Qué se espera lograr con el plan." },
      commitments: {
        type: "array",
        description: "Entre 1 y 3 compromisos concretos y medibles (indicador a mejorar + meta específica).",
        items: {
          type: "object",
          properties: {
            indicador: { type: "string", description: "El indicador o aspecto a mejorar." },
            meta: { type: "string", description: "La meta específica y medible para ese indicador." },
            responsable: { type: "string", enum: ["COLABORADOR", "LIDER"], description: "Si el compromiso depende principalmente del colaborador o de apoyo del líder." },
          },
          required: ["indicador", "meta", "responsable"],
        },
      },
    },
    required: ["situacion", "resultadoEsperado", "commitments"],
  },
};

// Confirmado 2026-09-10: la IA solo asiste al LÍDER a redactar — nunca
// escribe directo a la base de datos ni le sugiere nada al colaborador (ver
// docblock de ImprovementPlan en schema.prisma). El líder siempre revisa y
// confirma/edita este borrador antes de que exista un plan de verdad.
export async function draftImprovementPlan(params: { freeText: string; actorId: string }): Promise<ImprovementPlanDraft> {
  const client = getAnthropicClient();

  const draft = await requestToolInput<{
    situacion?: string;
    resultadoEsperado?: string;
    commitments?: { indicador?: string; meta?: string; responsable?: string }[];
  }>({
    client,
    feature: "plan_mejora_redaccion",
    actorId: params.actorId,
    userText: params.freeText,
    tool: SUBMIT_IMPROVEMENT_PLAN_TOOL,
    system:
      "Ayudas a un líder de equipo en Provedix (Guayaquil, Ecuador) a redactar el BORRADOR de un Plan de Mejora y Acompañamiento formal para un colaborador de su equipo. " +
      "Es un documento de Recursos Humanos serio — nunca inventes detalles, nombres, cifras ni hechos que el líder no haya mencionado. " +
      "Si el líder no dio suficiente información para algún campo, escribe algo breve y genérico basado solo en lo que sí dijo, nunca lo inventes de la nada. " +
      "Esto es SOLO UN BORRADOR: el líder lo va a revisar y editar antes de que el plan exista de verdad, así que prioriza fidelidad a lo que escribió por sobre completar huecos. " +
      "Debes proponer entre 1 y 3 compromisos concretos y medibles (indicador a mejorar + meta específica), y decidir si cada uno depende principalmente del colaborador o de apoyo del líder. " +
      `Si te sirve como referencia, estos son los indicadores típicos que se evalúan después en el seguimiento semanal: ${SUGGESTED_INDICATORS.join(", ")} — pero los compromisos del plan no tienen que limitarse a esa lista. ` +
      "Llama a submit_improvement_plan con el resultado — es la única forma de responder.",
  });

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

function buildSubmitWeeklyReviewTool(indicators: string[]) {
  return {
    name: "submit_weekly_review",
    description: "Registra el borrador de la evaluación semanal de un Plan de Mejora y Acompañamiento.",
    input_schema: {
      type: "object" as const,
      properties: {
        scores: {
          type: "array",
          description: "Calificación de 1 a 5 SOLO para los indicadores que el texto del líder realmente toca (no hace falta calificarlos todos — típicamente entre 4 y 8, nunca todos si el texto no da para tanto).",
          items: {
            type: "object",
            properties: {
              indicador: { type: "string", enum: indicators, description: "Debe ser EXACTAMENTE uno de los indicadores disponibles, tal cual." },
              score: { type: "number", description: "Calificación de 1 (bajo) a 5 (alto)." },
            },
            required: ["indicador", "score"],
          },
        },
        queMejoro: { type: "string", description: "Qué mejoró esta semana." },
        queFalta: { type: "string", description: "Qué sigue faltando." },
        accionSiguiente: { type: "string", description: "Qué se hará la próxima semana." },
        apoyoLider: { type: "string", description: "Qué apoyo dará el líder." },
      },
      required: ["scores", "queMejoro", "queFalta", "accionSiguiente", "apoyoLider"],
    },
  };
}

// Mismo espíritu que draftImprovementPlan: borrador editable para la
// evaluación semanal, nunca visible para el colaborador (ver punto 6 del
// diseño de la feature — la IA nunca le sugiere nada directo a él).
export async function draftWeeklyReview(params: {
  freeText: string;
  actorId: string;
  indicators: string[];
}): Promise<WeeklyReviewDraft> {
  const client = getAnthropicClient();

  const draft = await requestToolInput<{
    scores?: { indicador?: string; score?: number }[];
    queMejoro?: string;
    queFalta?: string;
    accionSiguiente?: string;
    apoyoLider?: string;
  }>({
    client,
    feature: "plan_mejora_evaluacion_semanal",
    actorId: params.actorId,
    userText: params.freeText,
    tool: buildSubmitWeeklyReviewTool(params.indicators),
    system:
      "Ayudas a un líder de equipo en Provedix (Guayaquil, Ecuador) a redactar el BORRADOR de la evaluación semanal de un Plan de Mejora y Acompañamiento. " +
      "Es un documento serio de seguimiento de desempeño — nunca inventes hechos, cifras o calificaciones que no se desprendan de lo que el líder escribió. " +
      "Esto es SOLO UN BORRADOR: el líder lo revisa y edita antes de guardarlo de verdad. " +
      `Los indicadores disponibles para calificar esta semana son: ${params.indicators.join(", ")}. ` +
      "queMejoro: qué mejoró esta semana. queFalta: qué sigue faltando. accionSiguiente: qué se hará la próxima semana. apoyoLider: qué apoyo dará el líder. " +
      "Llama a submit_weekly_review con el resultado — es la única forma de responder.",
  });

  const validIndicators = new Set(params.indicators);
  const scores: Record<string, number> = {};
  for (const entry of draft.scores ?? []) {
    if (!entry.indicador || !validIndicators.has(entry.indicador)) continue;
    const n = Number(entry.score);
    if (Number.isFinite(n)) scores[entry.indicador] = Math.max(1, Math.min(5, Math.round(n)));
  }
  return {
    scores,
    queMejoro: draft.queMejoro ?? "",
    queFalta: draft.queFalta ?? "",
    accionSiguiente: draft.accionSiguiente ?? "",
    apoyoLider: draft.apoyoLider ?? "",
  };
}
