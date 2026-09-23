import { prisma } from "@/lib/prisma";
import { getAnthropicClient } from "@/lib/nancy";
import { logAiUsage } from "@/lib/aiUsage";

const COMBO_MATCH_AI_MODEL = "claude-sonnet-5";

// Confirmado 2026-09-03 (pedido explícito del usuario, segunda vuelta): la
// primera versión solo comparaba productos dentro del MISMO nicho exacto —
// pero el catálogo tiene categorías casi duplicadas por texto libre de la IA
// (ej. "Hogar y organización" / "Hogar y limpieza" / "Limpieza del hogar" son
// básicamente lo mismo pero nunca se cruzan entre sí), así que se perdían
// combos reales solo por una diferencia de rótulo. Ahora se manda TODO el
// catálogo de ganadores y de baja rotación en una sola llamada — el nicho
// viaja solo como pista de contexto, nunca como filtro obligatorio — y la IA
// decide libremente qué combinaciones tienen sentido real, con un puntaje de
// confianza (0-100) por cada una.
const COMBO_MATCH_SYSTEM_PROMPT = `Eres un experto en armar combos de productos para una tienda de dropshipping en Ecuador (Provedix/DAFLOW).

Te doy dos listas de TODO el catálogo activo: "ganadores" (se están vendiendo bien ahora mismo) y "de baja rotación" (casi no se vendieron esta semana) — cada producto trae su categoría de referencia entre paréntesis, pero esa categoría es solo una pista, NO un filtro obligatorio: dos categorías escritas distinto pueden ser básicamente lo mismo (ej. "Hogar y organización" y "Limpieza del hogar"), y a veces dos productos de categorías totalmente distintas igual tienen sentido real como combo (ej. una funda de celular y un soporte para carro).

Tu tarea: de todas las combinaciones posibles (un ganador + uno de baja rotación), elegir SOLO las que tendrían sentido real como combo para vender juntos, porque se complementan en uso real (ej. funda de celular + protector de pantalla, cepillo de dientes eléctrico + repuestos de cabezal) o porque uno resuelve una necesidad relacionada al otro. Compartir o no categoría nunca decide esto por sí solo.

Para cada combinación que apruebes, dale un puntaje de 0 a 100 de qué tan segura es esa combinación como para vender bien junta (100 = combo obvio y muy probable, 50 = tiene lógica pero es más arriesgado).

Sé exigente: es mejor devolver pocas combinaciones con puntaje alto que muchas dudosas. Un producto puede aparecer en más de una combinación si de verdad tiene sentido con varios.

Responde ÚNICAMENTE con un objeto JSON (sin texto adicional, sin markdown) con esta forma exacta:
{ "pairs": [{ "winnerIndex": 0, "lowRotationIndex": 2, "score": 85 }] }
Los índices son la posición (empezando en 0) de cada producto dentro de la lista que te di. Si ninguna combinación tiene sentido real, responde { "pairs": [] }.`;

type ComboMatchPair = { winnerIndex: number; lowRotationIndex: number; score: number };

function parseComboMatchResponse(raw: string): ComboMatchPair[] {
  let text = raw.trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) text = fenced[1].trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }
  const pairs = (parsed as { pairs?: unknown })?.pairs;
  if (!Array.isArray(pairs)) return [];
  return pairs
    .filter(
      (p): p is Record<string, unknown> =>
        typeof p === "object" && p !== null && typeof (p as Record<string, unknown>).winnerIndex === "number" && typeof (p as Record<string, unknown>).lowRotationIndex === "number"
    )
    .map((p) => ({
      winnerIndex: p.winnerIndex as number,
      lowRotationIndex: p.lowRotationIndex as number,
      score: typeof p.score === "number" ? Math.max(0, Math.min(100, Math.round(p.score))) : 50,
    }));
}

export type ComboCandidate = { id: string; name: string; nicho: string | null };

// Confirmado 2026-09-03 (mismo día, corrección): mandar TODO el catálogo de
// ganadores (150+) en una sola llamada hacía que la IA intentara razonar
// cientos de combinaciones a la vez — la respuesta se cortaba al llegar al
// límite de tokens (JSON incompleto, se descartaba todo) y la llamada
// tardaba tanto que la función serverless se quedaba colgada sin terminar
// nunca ("se queda recalculando"). Se reparte a los ganadores en grupos
// chicos, cada grupo contra TODA la lista de baja rotación, corriendo todos
// los grupos EN PARALELO — cada llamada individual es rápida y con
// respuesta corta, y el tiempo total es el de la más lenta, no la suma.
const WINNER_CHUNK_SIZE = 20;

async function callComboMatchAi(winners: ComboCandidate[], lowRotation: ComboCandidate[], actorId: string): Promise<Map<string, number>> {
  try {
    const client = getAnthropicClient();
    const fmt = (items: ComboCandidate[]) => items.map((it, i) => `${i}. ${it.name} (${it.nicho ?? "sin categoría"})`).join("\n");
    const promptText = `Ganadores:\n${fmt(winners)}\n\nDe baja rotación:\n${fmt(lowRotation)}`;

    const response = await client.messages.create({
      model: COMBO_MATCH_AI_MODEL,
      max_tokens: 4096,
      system: COMBO_MATCH_SYSTEM_PROMPT,
      messages: [{ role: "user", content: promptText }],
    });

    await logAiUsage({
      feature: "combo_sugerencias_match",
      model: COMBO_MATCH_AI_MODEL,
      actorId,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    });

    const textBlock = response.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") return new Map();
    const pairs = parseComboMatchResponse(textBlock.text);
    const out = new Map<string, number>();
    for (const p of pairs) {
      if (p.winnerIndex < 0 || p.winnerIndex >= winners.length || p.lowRotationIndex < 0 || p.lowRotationIndex >= lowRotation.length) continue;
      out.set(`${winners[p.winnerIndex].id}::${lowRotation[p.lowRotationIndex].id}`, p.score);
    }
    return out;
  } catch (err) {
    // Best-effort: si un grupo falla por lo que sea, ese grupo simplemente no
    // suma sugerencias esta corrida en vez de tumbar todo el cruce.
    console.error("No se pudo filtrar un grupo de combos con IA:", err);
    return new Map();
  }
}

async function filterPlausibleComboPairs(winners: ComboCandidate[], lowRotation: ComboCandidate[], actorId: string): Promise<Map<string, number>> {
  const chunks: ComboCandidate[][] = [];
  for (let i = 0; i < winners.length; i += WINNER_CHUNK_SIZE) chunks.push(winners.slice(i, i + WINNER_CHUNK_SIZE));

  const results = await Promise.all(chunks.map((chunk) => callComboMatchAi(chunk, lowRotation, actorId)));
  const merged = new Map<string, number>();
  for (const r of results) for (const [key, score] of r) merged.set(key, score);
  return merged;
}

// Confirmado 2026-08-31: umbral real que definió el usuario — 8 o más
// despachos en la semana = "funcionó". Debajo de eso, "todavía no funciona"
// (ver LowRotationWeeklyEntry, la lista semanal de Daniel).
export const LOW_ROTATION_THRESHOLD = 8;

// Confirmado 2026-09-23: el archivo semanal de Just ya no existe (ya solo se
// trabaja con INVESTOCK) — esta es la única fuente de baja rotación
// automática, junto con la lista manual y ATOM.
// Confirmado 2026-09-16, pedido explícito del usuario: además de ATOM y del
// archivo semanal de Just, ahora INVESTOCK (el Kardex propio, real, sin
// depender de que nadie suba nada) también aporta candidatos — a partir de
// cuánto salió de verdad de bodega (StockKardexEntry tipo OUT) en los
// últimos 7 días. SUMA candidatos, nunca reemplaza a ATOM ni al archivo de
// Just — ver el porqué en la memoria del proyecto: ATOM detecta ventas que
// nunca tocan el Kardex (ej. Marcos vendiendo directo por la plataforma de
// Dropi, sin pasar por Ventas Externas/nuestra bodega), así que perder esa
// fuente dejaría ciegos a esos ganadores.
// Umbral de "ganador" confirmado explícitamente por el usuario: 50+
// unidades despachadas en 7 días. El de baja rotación reusa
// LOW_ROTATION_THRESHOLD (8), el mismo que ya usan las otras dos fuentes.
export const KARDEX_WINNER_THRESHOLD = 50;

async function getWinnersAndLowRotationFromKardex(): Promise<{ winnerIds: string[]; lowRotationCandidates: { catalogItemId: string; unitsMoved: number }[] }> {
  const since = new Date();
  since.setDate(since.getDate() - 7);

  const outEntries = await prisma.stockKardexEntry.groupBy({
    by: ["catalogItemId"],
    where: { type: "OUT", occurredAt: { gte: since } },
    _sum: { quantity: true },
  });

  const winnerIds: string[] = [];
  const lowRotationCandidates: { catalogItemId: string; unitsMoved: number }[] = [];
  for (const e of outEntries) {
    const unitsMoved = e._sum.quantity ?? 0;
    if (unitsMoved >= KARDEX_WINNER_THRESHOLD) winnerIds.push(e.catalogItemId);
    else if (unitsMoved < LOW_ROTATION_THRESHOLD) lowRotationCandidates.push({ catalogItemId: e.catalogItemId, unitsMoved });
  }
  return { winnerIds, lowRotationCandidates };
}

// Cruza los productos ganadores más recientes — de ATOM (status RENTABLE) Y
// del reporte mensual de Daniel de 200+ movimientos (MonthlyTopMoverEntry,
// solo el mes más reciente cargado) — con los productos de baja rotación más
// recientes — de la lista manual de Daniel (unitsDispatched < 8) Y del cruce
// automático contra el Excel semanal de stock (ver arriba). Confirmado
// 2026-09-03: ya no se agrupa por
// nicho exacto (ver comentario en filterPlausibleComboPairs) — se manda todo
// el catálogo de cada lado a la IA en una sola llamada y ella decide, con un
// puntaje de confianza, qué combinaciones tienen lógica real. Nunca duplica:
// @@unique([winnerCatalogItemId, lowRotationCatalogItemId]) en el modelo
// evita crear la misma pareja dos veces aunque el cruce corra varias veces
// con datos frescos — y una pareja que ya existe como ComboSuggestion nunca
// se le vuelve a preguntar a la IA en corridas futuras.
// actorId: quién disparó esta corrida (para el registro de gasto de IA) —
// "system" cuando corre desde un flujo sin usuario real.
export async function generateComboSuggestions(actorId = "system"): Promise<{ created: number }> {
  const [atomStatuses, lowRotationEntries, catalogItems, latestTopMoverMonth, kardexSignal] = await Promise.all([
    prisma.atomProductStatus.findMany({
      where: { status: "RENTABLE", isCombo: false, matchedCatalogItemId: { not: null } },
      orderBy: { capturedAt: "desc" },
      select: { matchedCatalogItemId: true, capturedAt: true },
    }),
    prisma.lowRotationWeeklyEntry.findMany({
      orderBy: { weekOf: "desc" },
      select: { catalogItemId: true, weekOf: true, unitsDispatched: true },
    }),
    prisma.purchaseCatalogItem.findMany({ select: { id: true, name: true, nicho: true } }),
    prisma.monthlyTopMoverEntry.findFirst({ orderBy: { month: "desc" }, select: { month: true } }),
    getWinnersAndLowRotationFromKardex(),
  ]);

  // Confirmado 2026-09-04: pedido explícito de Daniel — sus "productos
  // ganadores del mes" (200+ movimientos) SUMAN como otra fuente de
  // ganadores, junto a los diarios de ATOM — mismo patrón "suma, no
  // reemplaza" que ya usa el cruce automático de baja rotación. Solo se usa
  // el mes más reciente cargado (un producto ganador de hace 3 meses ya no
  // cuenta como ganador hoy).
  const monthlyTopMovers = latestTopMoverMonth
    ? await prisma.monthlyTopMoverEntry.findMany({ where: { month: latestTopMoverMonth.month }, select: { catalogItemId: true } })
    : [];

  // Solo la lectura más reciente de ATOM por producto decide si hoy es
  // ganador — un RENTABLE viejo no cuenta si luego bajó a SEGUIMIENTO.
  const latestAtomByItem = new Map<string, Date>();
  for (const s of atomStatuses) {
    const id = s.matchedCatalogItemId as string;
    if (!latestAtomByItem.has(id)) latestAtomByItem.set(id, s.capturedAt);
  }
  const winnerIds = new Set(latestAtomByItem.keys());
  for (const m of monthlyTopMovers) winnerIds.add(m.catalogItemId);
  // INVESTOCK (Kardex real) suma sus propios ganadores — nunca reemplaza a
  // ATOM ni al reporte mensual, por lo mismo de siempre: hay ventas (ej.
  // Marcos por la plataforma de Dropi directo) que nunca tocan nuestra
  // bodega y por lo tanto nunca aparecen en el Kardex.
  for (const id of kardexSignal.winnerIds) winnerIds.add(id);

  // Solo la semana más reciente de Daniel por producto decide si sigue de
  // baja rotación — si ya no aparece bajo el umbral la última vez, se saca
  // del cruce (aunque semanas anteriores sí lo tuvieran ahí).
  const latestWeekSeenByItem = new Map<string, Date>();
  const isLowRotationNow = new Map<string, boolean>();
  for (const e of lowRotationEntries) {
    const seen = latestWeekSeenByItem.get(e.catalogItemId);
    if (seen && seen.getTime() >= e.weekOf.getTime()) continue;
    latestWeekSeenByItem.set(e.catalogItemId, e.weekOf);
    isLowRotationNow.set(e.catalogItemId, e.unitsDispatched < LOW_ROTATION_THRESHOLD);
  }

  // El cruce automático con INVESTOCK SUMA candidatos — nunca apaga uno que
  // la lista manual de Daniel ya haya marcado explícitamente como "ya no".
  for (const c of kardexSignal.lowRotationCandidates) {
    if (isLowRotationNow.has(c.catalogItemId)) continue;
    isLowRotationNow.set(c.catalogItemId, true);
  }

  const catalogById = new Map(catalogItems.map((i) => [i.id, i]));

  const winners: ComboCandidate[] = [...winnerIds]
    .map((id) => catalogById.get(id))
    .filter((i): i is (typeof catalogItems)[number] => !!i)
    .map((i) => ({ id: i.id, name: i.name, nicho: i.nicho }));

  const lowRotation: ComboCandidate[] = [...isLowRotationNow.entries()]
    .filter(([, stillLow]) => stillLow)
    .map(([id]) => catalogById.get(id))
    .filter((i): i is (typeof catalogItems)[number] => !!i)
    .map((i) => ({ id: i.id, name: i.name, nicho: i.nicho }));

  if (winners.length === 0 || lowRotation.length === 0) return { created: 0 };

  const scoreByKey = await filterPlausibleComboPairs(winners, lowRotation, actorId);
  if (scoreByKey.size === 0) return { created: 0 };

  const candidateKeys = [...scoreByKey.keys()].filter((k) => {
    const [winnerId, lowId] = k.split("::");
    return winnerId !== lowId;
  });
  if (candidateKeys.length === 0) return { created: 0 };

  const existing = await prisma.comboSuggestion.findMany({
    where: { OR: candidateKeys.map((k) => { const [winnerCatalogItemId, lowRotationCatalogItemId] = k.split("::"); return { winnerCatalogItemId, lowRotationCatalogItemId }; }) },
    select: { winnerCatalogItemId: true, lowRotationCatalogItemId: true },
  });
  const existingKeys = new Set(existing.map((e) => `${e.winnerCatalogItemId}::${e.lowRotationCatalogItemId}`));

  const winnerById = new Map(winners.map((w) => [w.id, w]));
  const newRows = candidateKeys
    .filter((k) => !existingKeys.has(k))
    .map((k) => {
      const [winnerCatalogItemId, lowRotationCatalogItemId] = k.split("::");
      const winner = winnerById.get(winnerCatalogItemId);
      return {
        winnerCatalogItemId,
        lowRotationCatalogItemId,
        nicho: winner?.nicho ?? "General",
        matchScore: scoreByKey.get(k) ?? null,
      };
    });
  if (newRows.length === 0) return { created: 0 };

  const result = await prisma.comboSuggestion.createMany({ data: newRows, skipDuplicates: true });
  return { created: result.count };
}

// Cuántas semanas consecutivas lleva un producto en la lista de baja
// rotación de Daniel — usado como ranking simple en la pantalla de
// selección del equipo de MKT (mientras más semanas, más urgente moverlo).
export async function getLowRotationStreakWeeks(catalogItemId: string): Promise<number> {
  const entries = await prisma.lowRotationWeeklyEntry.findMany({
    where: { catalogItemId },
    orderBy: { weekOf: "desc" },
    select: { weekOf: true, unitsDispatched: true },
  });
  let streak = 0;
  for (const e of entries) {
    if (e.unitsDispatched >= LOW_ROTATION_THRESHOLD) break;
    streak++;
  }
  return streak;
}
