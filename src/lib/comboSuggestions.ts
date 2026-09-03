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

// Una sola llamada de IA revisa TODO el catálogo de ganadores contra TODO el
// de baja rotación a la vez (no una por pareja, para no disparar el costo) y
// devuelve solo las combinaciones con lógica real de combo + su puntaje.
async function filterPlausibleComboPairs(winners: ComboCandidate[], lowRotation: ComboCandidate[], actorId: string): Promise<Map<string, number>> {
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
    // Best-effort: si la IA falla por lo que sea, esta corrida simplemente no
    // suma sugerencias nuevas en vez de tumbar todo el cruce.
    console.error("No se pudo filtrar combos con IA:", err);
    return new Map();
  }
}

// Confirmado 2026-08-31: umbral real que definió el usuario — 8 o más
// despachos en la semana = "funcionó". Debajo de eso, "todavía no funciona"
// (ver LowRotationWeeklyEntry, la lista semanal de Daniel).
export const LOW_ROTATION_THRESHOLD = 8;

const WEEKLY_SNAPSHOT_PERIOD_RE = /^\d{4}-\d{2}-W[1-4]$/;

// Confirmado 2026-09-03 (pedido explícito del usuario, aclarado por Daniel):
// el Excel semanal de "Productos sin movimiento — stock por SKU" (Control de
// Inventario, InventoryProductSnapshot) usa el MISMO código que Just —
// verificado contra un archivo real: sus 55 códigos y nombres coinciden 1 a
// 1 con PurchaseCatalogItem.justCode. Daniel ya sube ese archivo cada semana
// para esa otra pantalla — nunca hizo falta pedirle que además llene "Baja
// rotación semanal" a mano: "unidades movidas esta semana" se puede
// aproximar como (stock de la semana pasada − stock de esta semana), y
// aplicar el mismo umbral de 8. Esto SUMA candidatos de baja rotación al
// cruce, además de (no en vez de) lo que alguien cargue a mano en
// LowRotationWeeklyEntry — ninguna de las dos fuentes es obligatoria.
async function getAutoLowRotationFromStockSnapshots(): Promise<{ catalogItemId: string; unitsMoved: number }[]> {
  const periodRows = await prisma.inventoryProductSnapshot.findMany({ select: { period: true }, distinct: ["period"] });
  const allPeriods = periodRows.map((r) => r.period);
  const weeklyPeriods = allPeriods.filter((p) => WEEKLY_SNAPSHOT_PERIOD_RE.test(p)).sort();

  let prevPeriod: string;
  let curPeriod: string;
  if (weeklyPeriods.length >= 2) {
    [prevPeriod, curPeriod] = weeklyPeriods.slice(-2);
  } else if (weeklyPeriods.length === 1) {
    // Primera semana real del proceso semanal (confirmado 2026-09-03) —
    // todavía no hay una semana anterior con qué comparar, así que se usa el
    // último snapshot MENSUAL (formato "YYYY-MM", el proceso de antes de
    // pasar a semanal) como base aproximada, solo para esta primera vez.
    const monthlyPeriods = allPeriods.filter((p) => /^\d{4}-\d{2}$/.test(p)).sort();
    if (monthlyPeriods.length === 0) return [];
    prevPeriod = monthlyPeriods[monthlyPeriods.length - 1];
    curPeriod = weeklyPeriods[0];
  } else {
    return []; // todavía no hay ningún snapshot semanal cargado
  }
  const [prevRows, curRows, catalogItems] = await Promise.all([
    prisma.inventoryProductSnapshot.findMany({ where: { period: prevPeriod }, select: { productCode: true, stock: true } }),
    prisma.inventoryProductSnapshot.findMany({ where: { period: curPeriod }, select: { productCode: true, stock: true } }),
    prisma.purchaseCatalogItem.findMany({ where: { justCode: { not: null } }, select: { id: true, justCode: true } }),
  ]);

  const prevStockByCode = new Map(prevRows.map((r) => [r.productCode, r.stock]));
  const catalogIdByJustCode = new Map(catalogItems.map((c) => [c.justCode as string, c.id]));

  const out: { catalogItemId: string; unitsMoved: number }[] = [];
  for (const row of curRows) {
    const catalogItemId = catalogIdByJustCode.get(row.productCode);
    if (!catalogItemId) continue; // producto del reporte de Finanzas que no está (o no tiene justCode) en Base de datos de productos
    const prevStock = prevStockByCode.get(row.productCode);
    if (prevStock === undefined) continue; // primera semana de este producto — nada con qué comparar
    const unitsMoved = Math.max(0, prevStock - row.stock); // un aumento de stock (reposición) nunca cuenta como "vendido"
    out.push({ catalogItemId, unitsMoved });
  }
  return out;
}

// Cruza los productos ganadores más recientes de ATOM (status RENTABLE) con
// los productos de baja rotación más recientes — de la lista manual de
// Daniel (unitsDispatched < 8) Y del cruce automático contra el Excel
// semanal de stock (ver arriba). Confirmado 2026-09-03: ya no se agrupa por
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
  const [atomStatuses, lowRotationEntries, catalogItems, autoLowRotation] = await Promise.all([
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
    getAutoLowRotationFromStockSnapshots(),
  ]);

  // Solo la lectura más reciente de ATOM por producto decide si hoy es
  // ganador — un RENTABLE viejo no cuenta si luego bajó a SEGUIMIENTO.
  const latestAtomByItem = new Map<string, Date>();
  for (const s of atomStatuses) {
    const id = s.matchedCatalogItemId as string;
    if (!latestAtomByItem.has(id)) latestAtomByItem.set(id, s.capturedAt);
  }

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

  // El cruce automático SUMA candidatos — nunca apaga uno que la lista
  // manual de Daniel ya haya marcado explícitamente como "ya no" (ver
  // comentario en getAutoLowRotationFromStockSnapshots).
  for (const a of autoLowRotation) {
    if (isLowRotationNow.has(a.catalogItemId)) continue;
    if (a.unitsMoved < LOW_ROTATION_THRESHOLD) isLowRotationNow.set(a.catalogItemId, true);
  }

  const catalogById = new Map(catalogItems.map((i) => [i.id, i]));

  const winners: ComboCandidate[] = [...latestAtomByItem.keys()]
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
