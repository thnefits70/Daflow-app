import { prisma } from "@/lib/prisma";
import { getAnthropicClient } from "@/lib/nancy";
import { logAiUsage } from "@/lib/aiUsage";
import { getCurrentStockByItemIds } from "@/lib/stockKardex";
import { resolveCostBasisForCatalogItems, computeComboDropiPrice, computeMarketProductSalePrice, bodegaUnitCost, COMBO_FULFILLMENT_COST, DROPI_MARGIN_DEFAULT } from "@/lib/marketProduct";
import { recommendedDropiStock } from "@/lib/dropiStockRecommendation";

const COMBO_MATCH_AI_MODEL = "claude-sonnet-5";

// Pedido del usuario 2026-09-30 (rediseño completo, reemplaza el cruce de
// parejas de 2026-09-03): los combos se arman SOLOS cada noche con lo que ya
// entra al sistema — sin esperar al reporte mensual de ganadores (que dejó de
// subirse a mano). Reglas confirmadas por el usuario:
// - Combo de 2: 1 ganador + 1 de baja salida.
// - Combo de 3: 2 ganadores + 1 de MUY baja salida (los que menos se movieron).
// - Siempre del mismo nicho (o equivalente: "Hogar y limpieza" = "Limpieza
//   del hogar") y con lógica real de uso juntos — eso lo confirma la IA.
// - Si un ganador ya es un combo registrado, entra con su receta real tal
//   cual (nunca se adivina una receta). Si no, 1 unidad por producto.
// - Nombre sugerido en la MISMA consulta a la IA (sin costo extra). Desde
//   2026-10-05: nombres reales unidos con " Y ", máximo 40 caracteres.
// - Un combo vive en una sola marca: la misma "huella" (productos×cantidad)
//   nunca se repite, ni contra otra sugerencia ni contra un combo ya
//   registrado en Stock Actual.
//
// Pedido del usuario 2026-10-03 (reemplaza la corrida de cada noche): la IA
// trabaja UNA sola vez por semana, el lunes a la medianoche (ver vercel.json).
// - Lo que la asesora B2B no mandó a aprobación en la semana pasa a
//   DESCARTADO (no se borra) y entra la lista nueva con TODOS los ganadores.
// - La lista queda fija toda la semana; nadie presiona nada.
// - La IA aprende: se le pasa lo que Bryan aprobó, lo que rechazó (con su
//   motivo), lo que la asesora no eligió y cuánto se vendió de verdad cada
//   combo ya creado en Dropi.
// - Cada combo trae una breve explicación (aiReason) de por qué podría ganar.

// "Funcionó" = 8+ despachos en la semana (umbral de Daniel, 2026-08-31).
export const LOW_ROTATION_THRESHOLD = 8;
// Ganador (confirmado 2026-09-30): 50+ en 7 días O 200+ en 30 días.
export const WINNER_7D_THRESHOLD = 50;
export const WINNER_30D_THRESHOLD = 200;
// En combos de 3 el de baja salida debe ser de los que casi no se movieron.
export const VERY_LOW_THRESHOLD = 3;
// Pedido del usuario 2026-10-05 (reemplaza el nombre "wow" de 4 palabras):
// el nombre une los nombres reales de los productos con " Y " (ej. "Pulidor
// De Uñas Y Secador Láser") y nunca pasa de 40 caracteres — el máximo que
// deja escribir Dropi al crear el producto.
export const COMBO_NAME_MAX_CHARS = 40;
// Tope de productos de baja salida por consulta (los más lentos primero).
const MAX_LOW_IN_PROMPT = 200;
const WINNER_CHUNK_SIZE = 20;
// 2026-10-03: con 4096 tokens la IA se quedaba sin espacio (el modelo piensa
// antes de responder y eso cuenta en el tope) — todas las respuestas desde el
// 1 de octubre llegaron cortadas, el JSON no se podía leer y se guardaban 0
// combos. Tope amplio + máximo de combos por respuesta (por cada grupo de 20
// ganadores).
const COMBO_MATCH_MAX_TOKENS = 16000;
const MAX_COMBOS_PER_CALL = 20;
const AI_REASON_MAX_CHARS = 400;
// Cuánto historial de decisiones se le pasa a la IA para aprender.
const LEARNING_DAYS = 90;
const LEARNING_MAX_PER_GROUP = 25;

export type ComboPart = { catalogItemId: string; quantity: number; fromComboCode: string | null };

type Candidate = {
  name: string;
  nicho: string | null;
  parts: ComboPart[];
  units7: number;
  units30: number;
};

const DAY_MS = 24 * 60 * 60 * 1000;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY_MS);

// "Huella" de un combo: productos×cantidad, ordenados. Dos combos con la
// misma huella son el mismo combo aunque se hayan armado distinto.
export function comboFingerprint(parts: { catalogItemId: string; quantity: number }[]): string {
  const qty = new Map<string, number>();
  for (const p of parts) qty.set(p.catalogItemId, (qty.get(p.catalogItemId) ?? 0) + p.quantity);
  return [...qty.entries()].map(([id, q]) => `${id}x${q}`).sort().join("|");
}

// Las huellas viejas se armaron en la base (orden de Postgres) — se vuelven
// a ordenar acá para comparar siempre igual.
function normalizeFingerprint(fp: string): string {
  return fp.split("|").sort().join("|");
}

// Palabras que no pueden quedar sueltas al final si se corta el nombre.
const DANGLING_WORDS = new Set(["y", "de", "del", "para", "con", "en", "la", "el", "los", "las", "-", "+", "/"]);

function trimDangling(words: string[]): string[] {
  const out = [...words];
  while (out.length > 0 && DANGLING_WORDS.has(out[out.length - 1].toLowerCase())) out.pop();
  return out;
}

function fitWords(words: string[]): string | null {
  const out: string[] = [];
  for (const w of words) {
    if ([...out, w].join(" ").length > COMBO_NAME_MAX_CHARS) break;
    out.push(w);
  }
  const trimmed = trimDangling(out);
  return trimmed.length > 0 ? trimmed.join(" ") : null;
}

export function clampComboName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const words = raw.replace(/["“”]/g, "").trim().split(/\s+/).filter(Boolean);
  return fitWords(words);
}

// Respaldo si la IA no manda nombre: los nombres reales unidos con " Y ",
// recortando cada uno a sus primeras palabras hasta que entre en 40.
export function comboNameFromProducts(names: string[]): string | null {
  const split = names.map((n) => n.replace(/\s+-\s+/g, " ").trim().split(/\s+/).filter(Boolean));
  const longest = Math.max(0, ...split.map((w) => w.length));
  for (let k = longest; k >= 1; k--) {
    const name = split.map((w) => trimDangling(w.slice(0, k)).join(" ")).filter(Boolean).join(" Y ");
    if (name.length <= COMBO_NAME_MAX_CHARS) return name;
  }
  return fitWords(split.map((w) => w[0]).filter(Boolean).join(" Y ").split(" "));
}

function mergeParts(parts: ComboPart[]): ComboPart[] {
  const byId = new Map<string, ComboPart>();
  for (const p of parts) {
    const cur = byId.get(p.catalogItemId);
    if (cur) cur.quantity += p.quantity;
    else byId.set(p.catalogItemId, { ...p });
  }
  return [...byId.values()];
}

// ---- Señales de movimiento (cortes / Kardex) ------------------------------

async function sumKardexOut(since: Date): Promise<Map<string, number>> {
  const rows = await prisma.stockKardexEntry.groupBy({
    by: ["catalogItemId"],
    where: { type: "OUT", occurredAt: { gte: since } },
    _sum: { quantity: true },
  });
  return new Map(rows.map((r) => [r.catalogItemId, r._sum.quantity ?? 0]));
}

// Cuántas veces se vendió cada combo registrado, contado desde los cortes
// (cada fila del corte guarda de qué combo salió). Se cuenta por el primer
// producto de la receta ÷ su cantidad en la receta. Las garantías no cuentan.
async function comboSales(combos: { code: string; components: { catalogItemId: string; quantity: number }[] }[]) {
  const since30 = daysAgo(30);
  const since7 = daysAgo(7);
  const rows = await prisma.fulfillmentRequestItem.findMany({
    where: { fromComboCode: { not: null }, warrantyGuide: null, batch: { requestedAt: { gte: since30 } } },
    select: { catalogItemId: true, quantity: true, fromComboCode: true, batch: { select: { requestedAt: true } } },
  });
  const firstByCode = new Map(combos.filter((c) => c.components.length > 0).map((c) => [c.code, c.components[0]]));
  const out = new Map<string, { units7: number; units30: number }>();
  for (const r of rows) {
    const first = firstByCode.get(r.fromComboCode!);
    if (!first || first.catalogItemId !== r.catalogItemId) continue;
    const units = r.quantity / Math.max(1, first.quantity);
    const cur = out.get(r.fromComboCode!) ?? { units7: 0, units30: 0 };
    cur.units30 += units;
    if (r.batch.requestedAt >= since7) cur.units7 += units;
    out.set(r.fromComboCode!, cur);
  }
  return out;
}

const isWinner = (units7: number, units30: number) => units7 >= WINNER_7D_THRESHOLD || units30 >= WINNER_30D_THRESHOLD;

export type CurrentWinner = { key: string; name: string; isCombo: boolean; units7: number; units30: number };

// Ganadores de ahora mismo, sin reporte manual: lo que salió de bodega en
// los cortes (Kardex OUT) y los combos que más se vendieron. Se usa en el
// armado de combos y en la pantalla de KPIs Generales (solo lectura).
export async function getCurrentWinners(): Promise<CurrentWinner[]> {
  const [out7, out30, catalog, combos] = await Promise.all([
    sumKardexOut(daysAgo(7)),
    sumKardexOut(daysAgo(30)),
    prisma.purchaseCatalogItem.findMany({ select: { id: true, name: true } }),
    prisma.dropiCombo.findMany({ select: { code: true, label: true, components: { select: { catalogItemId: true, quantity: true } } } }),
  ]);
  const sales = await comboSales(combos);
  const nameById = new Map(catalog.map((c) => [c.id, c.name]));
  const winners: CurrentWinner[] = [];
  for (const [id, units30] of out30) {
    const units7 = out7.get(id) ?? 0;
    if (isWinner(units7, units30) && nameById.has(id)) winners.push({ key: `i:${id}`, name: nameById.get(id)!, isCombo: false, units7, units30 });
  }
  for (const c of combos) {
    const s = sales.get(c.code);
    if (s && isWinner(s.units7, s.units30)) {
      winners.push({ key: `c:${c.code}`, name: c.label ? `${c.label} (combo ${c.code})` : `Combo ${c.code}`, isCombo: true, units7: Math.floor(s.units7), units30: Math.floor(s.units30) });
    }
  }
  return winners.sort((a, b) => b.units30 - a.units30);
}

// ---- IA: elegir combos con lógica + nombre -------------------------------

const COMBO_MATCH_SYSTEM_PROMPT = `Eres un experto en armar combos de productos para una tienda de dropshipping en Ecuador.

Te doy dos listas: "ganadores" (se venden muy bien ahora) y "de baja salida" (casi no se venden; entre corchetes cuántas unidades salieron en los últimos 7 días). Cada producto trae su nicho entre paréntesis. Un ganador puede ser un combo que ya existe.

Arma combos que tengan sentido real para venderse juntos. Reglas OBLIGATORIAS:
1. Combo de 2: exactamente 1 ganador + 1 de baja salida.
2. Combo de 3: exactamente 2 ganadores + 1 de baja salida que haya salido 0 a ${VERY_LOW_THRESHOLD} unidades. Prefiere siempre los que salieron menos (0 primero).
3. Todos los productos del combo deben ser del MISMO nicho o de nichos equivalentes escritos distinto (ej. "Hogar y limpieza" y "Limpieza del hogar" son el mismo). Nunca mezcles nichos distintos.
4. Deben complementarse en uso real (ej. licuadora + vasos térmicos). Compartir nicho por sí solo no basta.
5. A cada combo ponle un nombre que una los nombres REALES de sus productos con " Y " (ej. "Producto A Y Producto B" o "Producto A Y Producto B Y Producto C"), en el mismo orden: primero los ganadores y al final el de baja salida. Para que entre, acorta cada nombre a sus palabras clave (quita "Kit", "Premium", marcas, guiones y adjetivos de relleno), pero que se reconozca cada producto. MÁXIMO ${COMBO_NAME_MAX_CHARS} caracteres contando espacios (es el límite de Dropi). Sin la palabra "combo". Cada palabra con mayúscula inicial y con tildes y ñ correctas.
6. Dale un puntaje de 0 a 100 de qué tan probable es que se venda bien.
7. Explica en "reason", en español sencillo y en máximo 2 oraciones cortas: por qué el ganador se está vendiendo, por qué el de baja salida lo complementa y por qué juntos podrían ser un combo ganador.

Si te paso "Historial de decisiones", aprende de él: arma más combos del estilo de los APROBADOS y de los que más se VENDIERON, y evita el estilo de los RECHAZADOS (lee su motivo) y de los NO ELEGIDOS.

Sé exigente: pocos combos buenos valen más que muchos dudosos (máximo ${MAX_COMBOS_PER_CALL} por respuesta). Un producto puede estar en más de un combo.

Responde ÚNICAMENTE con JSON (sin markdown):
{ "combos": [{ "winners": [0], "low": 2, "score": 85, "name": "Licuadora Portátil Y Vaso Térmico", "reason": "La licuadora se vende mucho esta semana. Los vasos térmicos casi no salen, pero son el complemento natural para llevar el batido." }] }
Los números son la posición (desde 0) en cada lista. Si nada tiene sentido: { "combos": [] }.`;

type AiCombo = { winners: number[]; low: number; score: number; name: string | null; reason: string | null };

function parseAiCombos(raw: string): AiCombo[] {
  let text = raw.trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) text = fenced[1].trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }
  const combos = (parsed as { combos?: unknown })?.combos;
  if (!Array.isArray(combos)) return [];
  const out: AiCombo[] = [];
  for (const c of combos) {
    if (typeof c !== "object" || c === null) continue;
    const r = c as Record<string, unknown>;
    if (!Array.isArray(r.winners) || typeof r.low !== "number") continue;
    const winners = r.winners.filter((w): w is number => typeof w === "number");
    out.push({
      winners,
      low: r.low,
      score: typeof r.score === "number" ? Math.max(0, Math.min(100, Math.round(r.score))) : 50,
      name: clampComboName(r.name),
      reason: typeof r.reason === "string" && r.reason.trim() ? r.reason.trim().slice(0, AI_REASON_MAX_CHARS) : null,
    });
  }
  return out;
}

async function askAi(winners: Candidate[], lows: Candidate[], learning: string, actorId: string): Promise<AiCombo[]> {
  try {
    const client = getAnthropicClient();
    const w = winners.map((c, i) => `${i}. ${c.name} (${c.nicho ?? "sin nicho"})`).join("\n");
    const l = lows.map((c, i) => `${i}. ${c.name} (${c.nicho ?? "sin nicho"}) [${c.units7}]`).join("\n");
    const response = await client.messages.create({
      model: COMBO_MATCH_AI_MODEL,
      max_tokens: COMBO_MATCH_MAX_TOKENS,
      system: COMBO_MATCH_SYSTEM_PROMPT,
      messages: [{ role: "user", content: `Ganadores:\n${w}\n\nDe baja salida:\n${l}${learning ? `\n\nHistorial de decisiones:\n${learning}` : ""}` }],
    });
    await logAiUsage({
      feature: "combo_sugerencias_match",
      model: COMBO_MATCH_AI_MODEL,
      actorId,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    });
    if (response.stop_reason === "max_tokens") console.error("Combos IA: respuesta cortada por el tope de tokens.");
    const textBlock = response.content.find((b) => b.type === "text");
    return textBlock && textBlock.type === "text" ? parseAiCombos(textBlock.text) : [];
  } catch (err) {
    // Best-effort: si un grupo falla, ese grupo no suma esta noche.
    console.error("No se pudo armar un grupo de combos con IA:", err);
    return [];
  }
}

// ---- Aprendizaje ----------------------------------------------------------

// Pedido del usuario 2026-10-03: cada semana la IA ve qué se aprobó, qué se
// rechazó (y por qué), qué no eligió la asesora y cuánto se vendió de verdad
// cada combo ya creado — para sugerir más de lo que funciona.
async function buildLearningNotes(): Promise<string> {
  const rows = await prisma.comboSuggestion.findMany({
    where: { status: { in: ["APROBADO", "CREADO_EN_DROPI", "RECHAZADO", "DESCARTADO"] }, generatedAt: { gte: daysAgo(LEARNING_DAYS) } },
    orderBy: { generatedAt: "desc" },
    select: {
      status: true,
      suggestedName: true,
      nicho: true,
      rejectReason: true,
      items: { select: { quantity: true, catalogItem: { select: { name: true } } } },
      dropiCombo: { select: { code: true, components: { select: { catalogItemId: true, quantity: true } } } },
    },
  });
  if (rows.length === 0) return "";
  const created = rows.filter((r) => r.dropiCombo).map((r) => r.dropiCombo!);
  const sales = created.length > 0 ? await comboSales(created) : new Map<string, { units7: number; units30: number }>();
  const line = (r: (typeof rows)[number], extra: string) =>
    `- "${r.suggestedName ?? "sin nombre"}" (${r.nicho}): ${r.items.map((i) => `${i.quantity > 1 ? `${i.quantity}× ` : ""}${i.catalogItem.name}`).join(" + ")}${extra}`;
  const approved = rows.filter((r) => r.status === "APROBADO" || r.status === "CREADO_EN_DROPI").slice(0, LEARNING_MAX_PER_GROUP);
  const rejected = rows.filter((r) => r.status === "RECHAZADO").slice(0, LEARNING_MAX_PER_GROUP);
  const discarded = rows.filter((r) => r.status === "DESCARTADO").slice(0, LEARNING_MAX_PER_GROUP);
  const parts: string[] = [];
  if (approved.length > 0) {
    parts.push(
      "APROBADOS por el líder:\n" +
        approved
          .map((r) => {
            const sold = r.dropiCombo ? Math.floor(sales.get(r.dropiCombo.code)?.units30 ?? 0) : null;
            return line(r, sold === null ? "" : ` · se vendió ${sold} veces en los últimos 30 días`);
          })
          .join("\n")
    );
  }
  if (rejected.length > 0) parts.push("RECHAZADOS por el líder:\n" + rejected.map((r) => line(r, ` · motivo: ${r.rejectReason ?? "sin motivo"}`)).join("\n"));
  if (discarded.length > 0) parts.push("NO ELEGIDOS por la asesora:\n" + discarded.map((r) => line(r, "")).join("\n"));
  return parts.join("\n\n");
}

// ---- Armado ---------------------------------------------------------------

// actorId: quién disparó la corrida (registro de gasto de IA) — "system"
// cuando corre sola de noche.
export async function generateComboSuggestions(actorId = "system"): Promise<{ created: number }> {
  const since7 = daysAgo(7);
  // 2026-10-01 (pedido del usuario): ya no se usan ATOM ni la lista manual
  // de baja rotación — todo sale de los cortes. Esos datos viejos quedan
  // guardados pero no entran al armado.
  // Renovación del lunes: lo que la asesora no mandó a aprobación en toda la
  // semana deja de verse (queda como DESCARTADO para que la IA aprenda).
  await prisma.comboSuggestion.updateMany({ where: { status: "SUGERIDO" }, data: { status: "DESCARTADO" } });
  const [out7, out30, catalog, combos, latestBalances, existingFps, learning] = await Promise.all([
    sumKardexOut(since7),
    sumKardexOut(daysAgo(30)),
    prisma.purchaseCatalogItem.findMany({ select: { id: true, name: true, nicho: true, justCode: true } }),
    prisma.dropiCombo.findMany({ select: { code: true, label: true, components: { select: { catalogItemId: true, quantity: true } } } }),
    prisma.stockKardexEntry.findMany({
      distinct: ["catalogItemId"],
      orderBy: [{ catalogItemId: "asc" }, { occurredAt: "desc" }, { createdAt: "desc" }],
      select: { catalogItemId: true, balanceAfter: true },
    }),
    prisma.comboSuggestion.findMany({ where: { fingerprint: { not: null } }, select: { fingerprint: true } }),
    buildLearningNotes(),
  ]);
  const sales = await comboSales(combos);
  // Regla del usuario 2026-09-23: un combo solo lleva productos con su ID
  // real de Dropi — los que no lo tienen no entran al armado.
  const catalogById = new Map(catalog.filter((c) => c.justCode?.trim()).map((c) => [c.id, c]));

  // Ganadores: productos (cortes/Kardex) y combos registrados.
  const winners = new Map<string, Candidate>();
  const addItemWinner = (id: string) => {
    const item = catalogById.get(id);
    if (!item || winners.has(`i:${id}`)) return;
    winners.set(`i:${id}`, { name: item.name, nicho: item.nicho, parts: [{ catalogItemId: id, quantity: 1, fromComboCode: null }], units7: out7.get(id) ?? 0, units30: out30.get(id) ?? 0 });
  };
  for (const [id, units30] of out30) if (isWinner(out7.get(id) ?? 0, units30)) addItemWinner(id);
  for (const c of combos) {
    const s = sales.get(c.code);
    if (!s || !isWinner(s.units7, s.units30) || c.components.length === 0) continue;
    const firstItem = catalogById.get(c.components[0].catalogItemId);
    winners.set(`c:${c.code}`, {
      name: c.label ? `${c.label} (combo)` : `Combo ${c.code}`,
      nicho: firstItem?.nicho ?? null,
      parts: c.components.map((x) => ({ catalogItemId: x.catalogItemId, quantity: x.quantity, fromComboCode: c.code })),
      units7: s.units7,
      units30: s.units30,
    });
  }

  const winnerList = [...winners.values()];

  // Baja salida: todo lo que tiene stock en bodega y salió menos de 8 en 7
  // días (incluye los que salieron 0).
  const winnerItemIds = new Set([...winners.values()].flatMap((w) => w.parts.map((p) => p.catalogItemId)));
  const lowUnits = new Map<string, number>();
  for (const b of latestBalances) {
    const units = out7.get(b.catalogItemId) ?? 0;
    if (b.balanceAfter > 0 && units < LOW_ROTATION_THRESHOLD) lowUnits.set(b.catalogItemId, units);
  }
  const lowList: Candidate[] = [...lowUnits.entries()]
    .filter(([id]) => !winnerItemIds.has(id) && catalogById.has(id))
    .sort((a, b) => a[1] - b[1])
    .slice(0, MAX_LOW_IN_PROMPT)
    .map(([id, units]) => {
      const item = catalogById.get(id)!;
      return { name: item.name, nicho: item.nicho, parts: [{ catalogItemId: id, quantity: 1, fromComboCode: null }], units7: units, units30: out30.get(id) ?? 0 };
    });

  if (winnerList.length === 0 || lowList.length === 0) return { created: 0 };

  const chunks: Candidate[][] = [];
  for (let i = 0; i < winnerList.length; i += WINNER_CHUNK_SIZE) chunks.push(winnerList.slice(i, i + WINNER_CHUNK_SIZE));
  const results = await Promise.all(chunks.map((chunk) => askAi(chunk, lowList, learning, actorId)));

  // Huellas ya usadas: sugerencias de antes + combos registrados en Stock
  // Actual (de cualquier marca) — un combo nunca se repite en otra marca.
  const usedFps = new Set(existingFps.map((r) => normalizeFingerprint(r.fingerprint!)));
  for (const c of combos) if (c.components.length > 0) usedFps.add(comboFingerprint(c.components));

  let created = 0;
  for (let ci = 0; ci < chunks.length; ci++) {
    const chunk = chunks[ci];
    for (const ai of results[ci]) {
      const ws = [...new Set(ai.winners)].map((i) => chunk[i]).filter((w): w is Candidate => !!w);
      const low = lowList[ai.low];
      if (!low || ws.length !== ai.winners.length || (ws.length !== 1 && ws.length !== 2)) continue;
      if (ws.length === 2 && low.units7 > VERY_LOW_THRESHOLD) continue;
      const lowId = low.parts[0].catalogItemId;
      const winnerParts = mergeParts(ws.flatMap((w) => w.parts));
      if (winnerParts.some((p) => p.catalogItemId === lowId)) continue;
      const parts = [...winnerParts, low.parts[0]];
      const fp = comboFingerprint(parts);
      if (usedFps.has(fp)) continue;
      usedFps.add(fp);
      try {
        await prisma.comboSuggestion.create({
          data: {
            nicho: ws[0].nicho ?? "General",
            winnerCatalogItemId: winnerParts[0].catalogItemId,
            lowRotationCatalogItemId: lowId,
            matchScore: ai.score,
            suggestedName: ai.name ?? comboNameFromProducts([...winnerParts, low.parts[0]].map((p) => catalogById.get(p.catalogItemId)?.name ?? "")),
            aiReason: ai.reason,
            fingerprint: fp,
            items: {
              create: [
                ...winnerParts.map((p) => ({ catalogItemId: p.catalogItemId, quantity: p.quantity, role: "WINNER" as const, fromComboCode: p.fromComboCode })),
                { catalogItemId: lowId, quantity: 1, role: "LOW" as const },
              ],
            },
          },
        });
        created++;
      } catch {
        // Huella repetida por una corrida en paralelo — se ignora.
      }
    }
  }
  return { created };
}

// ---- Renombrar los que ya están en pantalla --------------------------------

// Pedido del usuario 2026-10-05: los combos que salieron antes de la regla de
// nombres ("A Y B", máx. 40) se renombran una vez. Solo los que aún no se
// crean en Dropi; productos, precio y stock no se tocan.
const RENAME_SYSTEM_PROMPT = `Pon nombre a combos de productos para publicarlos en Dropi (Ecuador).
Regla: une los nombres REALES de los productos con " Y ", en el orden que te los doy. Acorta cada nombre a sus palabras clave (quita "Kit", "Premium", marcas, guiones y adjetivos de relleno) pero que se reconozca cada producto. MÁXIMO ${COMBO_NAME_MAX_CHARS} caracteres contando espacios. Sin la palabra "combo". Cada palabra con mayúscula inicial y con tildes y ñ correctas.
Responde ÚNICAMENTE con JSON (sin markdown): { "names": { "<id>": "Nombre" } }`;

export async function renameOpenComboSuggestions(actorId = "system"): Promise<{ id: string; before: string | null; after: string }[]> {
  const rows = await prisma.comboSuggestion.findMany({
    where: { status: { in: ["SUGERIDO", "SELECCIONADO", "PENDIENTE_APROBACION", "APROBADO"] } },
    select: { id: true, suggestedName: true, items: { select: { role: true, catalogItem: { select: { name: true } } } } },
  });
  if (rows.length === 0) return [];
  const productNames = (r: (typeof rows)[number]) =>
    [...r.items.filter((i) => i.role !== "LOW"), ...r.items.filter((i) => i.role === "LOW")].map((i) => i.catalogItem.name);
  let aiNames: Record<string, unknown> = {};
  try {
    const client = getAnthropicClient();
    const response = await client.messages.create({
      model: COMBO_MATCH_AI_MODEL,
      max_tokens: COMBO_MATCH_MAX_TOKENS,
      system: RENAME_SYSTEM_PROMPT,
      messages: [{ role: "user", content: rows.map((r) => `${r.id}: ${productNames(r).join(" | ")}`).join("\n") }],
    });
    await logAiUsage({ feature: "combo_sugerencias_match", model: COMBO_MATCH_AI_MODEL, actorId, inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens });
    const textBlock = response.content.find((b) => b.type === "text");
    let text = textBlock && textBlock.type === "text" ? textBlock.text.trim() : "";
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced) text = fenced[1].trim();
    aiNames = (JSON.parse(text) as { names?: Record<string, unknown> }).names ?? {};
  } catch (err) {
    console.error("No se pudieron pedir los nombres a la IA, se usan los nombres reales recortados:", err);
  }
  const out: { id: string; before: string | null; after: string }[] = [];
  for (const r of rows) {
    const after = clampComboName(aiNames[r.id]) ?? comboNameFromProducts(productNames(r));
    if (!after || after === r.suggestedName) continue;
    await prisma.comboSuggestion.update({ where: { id: r.id }, data: { suggestedName: after } });
    out.push({ id: r.id, before: r.suggestedName, after });
  }
  return out;
}

// ---- Precio y stock para la pantalla --------------------------------------

export type ComboPricing = {
  // Precio Dropi del combo (fulfillment una sola vez, margen 20%). null si
  // a algún producto le falta el costo.
  dropiPrice: number | null;
  // Lo que costaría comprar cada producto por separado en Dropi.
  separatePrice: number | null;
  missingCostItemIds: string[];
  // "≈ N" — cuántos combos completos alcanzan con el stock real.
  referenceStock: number | null;
  limitingItemId: string | null;
  recommendedStock: number | null;
  // Pedido del usuario 2026-10-05: al pulsar el precio se ve de dónde sale.
  formula: ComboPriceFormula | null;
};

export type ComboPriceFormula = {
  parts: { catalogItemId: string; quantity: number; unitCost: number; insuranceRatePercent: number; withInsurance: number; subtotal: number }[];
  fulfillment: number;
  benistock: number;
  marginPercent: number;
};

export async function priceCombos(list: { id: string; parts: { catalogItemId: string; quantity: number }[] }[]): Promise<Map<string, ComboPricing>> {
  const ids = [...new Set(list.flatMap((c) => c.parts.map((p) => p.catalogItemId)))];
  const [costBasis, stock] = await Promise.all([resolveCostBasisForCatalogItems(ids), getCurrentStockByItemIds(ids)]);
  const out = new Map<string, ComboPricing>();
  for (const c of list) {
    const missing = c.parts.filter((p) => !costBasis.has(p.catalogItemId)).map((p) => p.catalogItemId);
    let dropiPrice: number | null = null;
    let separatePrice: number | null = null;
    let formula: ComboPriceFormula | null = null;
    if (missing.length === 0 && c.parts.length > 0) {
      // Mismos pasos que computeComboDropiPrice, separados para mostrarlos.
      const parts = c.parts.map((p) => {
        const cb = costBasis.get(p.catalogItemId)!;
        const unitCost = bodegaUnitCost(cb.batchCost, cb.freightCost, cb.batchUnits);
        const withInsurance = unitCost * (1 + cb.insuranceRatePercent / 100);
        return { catalogItemId: p.catalogItemId, quantity: p.quantity, unitCost, insuranceRatePercent: cb.insuranceRatePercent, withInsurance, subtotal: withInsurance * p.quantity };
      });
      formula = {
        parts,
        fulfillment: COMBO_FULFILLMENT_COST,
        benistock: parts.reduce((acc, x) => acc + x.subtotal, 0) + COMBO_FULFILLMENT_COST,
        marginPercent: DROPI_MARGIN_DEFAULT,
      };
      dropiPrice = computeComboDropiPrice(
        c.parts.map((p) => ({ ...costBasis.get(p.catalogItemId)!, quantity: p.quantity })),
        DROPI_MARGIN_DEFAULT
      );
      separatePrice = c.parts.reduce((acc, p) => {
        const cb = costBasis.get(p.catalogItemId)!;
        return acc + computeMarketProductSalePrice({ ...cb, marginPercent: cb.marginPercent ?? DROPI_MARGIN_DEFAULT }) * p.quantity;
      }, 0);
    }
    let referenceStock: number | null = null;
    let limitingItemId: string | null = null;
    for (const p of c.parts) {
      const balance = stock.get(p.catalogItemId)?.balance;
      if (balance === undefined) {
        referenceStock = null;
        limitingItemId = null;
        break;
      }
      const n = Math.floor(Math.max(0, balance) / Math.max(1, p.quantity));
      if (referenceStock === null || n < referenceStock) {
        referenceStock = n;
        limitingItemId = p.catalogItemId;
      }
    }
    out.set(c.id, {
      dropiPrice: dropiPrice === null ? null : Math.round(dropiPrice * 100) / 100,
      separatePrice: separatePrice === null ? null : Math.round(separatePrice * 100) / 100,
      missingCostItemIds: missing,
      referenceStock,
      limitingItemId,
      recommendedStock: referenceStock === null ? null : recommendedDropiStock(referenceStock),
      formula,
    });
  }
  return out;
}

// ¿Esta huella ya existe como combo registrado en Stock Actual? (cualquier
// marca) — un combo nunca se repite en otra marca.
export async function findRegisteredComboWithFingerprint(fp: string): Promise<{ code: string; bodega: string | null } | null> {
  const combos = await prisma.dropiCombo.findMany({ select: { code: true, bodega: true, components: { select: { catalogItemId: true, quantity: true } } } });
  const target = normalizeFingerprint(fp);
  const hit = combos.find((c) => c.components.length > 0 && comboFingerprint(c.components) === target);
  return hit ? { code: hit.code, bodega: hit.bodega } : null;
}
