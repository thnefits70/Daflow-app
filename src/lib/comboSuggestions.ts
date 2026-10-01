import { prisma } from "@/lib/prisma";
import { getAnthropicClient } from "@/lib/nancy";
import { logAiUsage } from "@/lib/aiUsage";
import { getCurrentStockByItemIds } from "@/lib/stockKardex";
import { resolveCostBasisForCatalogItems, computeComboDropiPrice, computeMarketProductSalePrice, DROPI_MARGIN_DEFAULT } from "@/lib/marketProduct";
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
// - Nombre llamativo de máximo 4 palabras, sugerido en la MISMA consulta a
//   la IA (sin costo extra).
// - Un combo vive en una sola marca: la misma "huella" (productos×cantidad)
//   nunca se repite, ni contra otra sugerencia ni contra un combo ya
//   registrado en Stock Actual.

// "Funcionó" = 8+ despachos en la semana (umbral de Daniel, 2026-08-31).
export const LOW_ROTATION_THRESHOLD = 8;
// Ganador (confirmado 2026-09-30): 50+ en 7 días O 200+ en 30 días.
export const WINNER_7D_THRESHOLD = 50;
export const WINNER_30D_THRESHOLD = 200;
// En combos de 3 el de baja salida debe ser de los que casi no se movieron.
export const VERY_LOW_THRESHOLD = 3;
export const COMBO_NAME_MAX_WORDS = 4;
// Un ganador con 3 sugerencias abiertas ya no se le vuelve a preguntar a la
// IA hasta que la asesora B2B las mande o se descarten — evita gastar en
// repetir lo mismo cada noche.
const MAX_OPEN_PER_WINNER = 3;
// Tope de productos de baja salida por consulta (los más lentos primero).
const MAX_LOW_IN_PROMPT = 200;
const WINNER_CHUNK_SIZE = 20;

const OPEN_STATUSES = ["SUGERIDO", "SELECCIONADO", "PENDIENTE_APROBACION"] as const;

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

export function clampComboName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const words = raw.replace(/["“”]/g, "").trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return null;
  return words.slice(0, COMBO_NAME_MAX_WORDS).join(" ");
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
5. A cada combo ponle un nombre en español, llamativo, con efecto "wow", de máximo ${COMBO_NAME_MAX_WORDS} palabras, sin marcas ni la palabra "combo".
6. Dale un puntaje de 0 a 100 de qué tan probable es que se venda bien.

Sé exigente: pocos combos buenos valen más que muchos dudosos. Un producto puede estar en más de un combo.

Responde ÚNICAMENTE con JSON (sin markdown):
{ "combos": [{ "winners": [0], "low": 2, "score": 85, "name": "Batido Express Total" }] }
Los números son la posición (desde 0) en cada lista. Si nada tiene sentido: { "combos": [] }.`;

type AiCombo = { winners: number[]; low: number; score: number; name: string | null };

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
    });
  }
  return out;
}

async function askAi(winners: Candidate[], lows: Candidate[], actorId: string): Promise<AiCombo[]> {
  try {
    const client = getAnthropicClient();
    const w = winners.map((c, i) => `${i}. ${c.name} (${c.nicho ?? "sin nicho"})`).join("\n");
    const l = lows.map((c, i) => `${i}. ${c.name} (${c.nicho ?? "sin nicho"}) [${c.units7}]`).join("\n");
    const response = await client.messages.create({
      model: COMBO_MATCH_AI_MODEL,
      max_tokens: 4096,
      system: COMBO_MATCH_SYSTEM_PROMPT,
      messages: [{ role: "user", content: `Ganadores:\n${w}\n\nDe baja salida:\n${l}` }],
    });
    await logAiUsage({
      feature: "combo_sugerencias_match",
      model: COMBO_MATCH_AI_MODEL,
      actorId,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    });
    const textBlock = response.content.find((b) => b.type === "text");
    return textBlock && textBlock.type === "text" ? parseAiCombos(textBlock.text) : [];
  } catch (err) {
    // Best-effort: si un grupo falla, ese grupo no suma esta noche.
    console.error("No se pudo armar un grupo de combos con IA:", err);
    return [];
  }
}

// ---- Armado ---------------------------------------------------------------

// actorId: quién disparó la corrida (registro de gasto de IA) — "system"
// cuando corre sola de noche.
export async function generateComboSuggestions(actorId = "system"): Promise<{ created: number }> {
  const since7 = daysAgo(7);
  const [out7, out30, catalog, combos, atomStatuses, lowRotationEntries, latestBalances, openRows, existingFps] = await Promise.all([
    sumKardexOut(since7),
    sumKardexOut(daysAgo(30)),
    prisma.purchaseCatalogItem.findMany({ select: { id: true, name: true, nicho: true, justCode: true } }),
    prisma.dropiCombo.findMany({ select: { code: true, label: true, components: { select: { catalogItemId: true, quantity: true } } } }),
    prisma.atomProductStatus.findMany({
      where: { status: "RENTABLE", isCombo: false, matchedCatalogItemId: { not: null } },
      orderBy: { capturedAt: "desc" },
      select: { matchedCatalogItemId: true },
    }),
    prisma.lowRotationWeeklyEntry.findMany({ orderBy: { weekOf: "desc" }, select: { catalogItemId: true, weekOf: true, unitsDispatched: true } }),
    prisma.stockKardexEntry.findMany({
      distinct: ["catalogItemId"],
      orderBy: [{ catalogItemId: "asc" }, { occurredAt: "desc" }, { createdAt: "desc" }],
      select: { catalogItemId: true, balanceAfter: true },
    }),
    prisma.comboSuggestion.groupBy({ by: ["winnerCatalogItemId"], where: { status: { in: [...OPEN_STATUSES] } }, _count: { _all: true } }),
    prisma.comboSuggestion.findMany({ where: { fingerprint: { not: null } }, select: { fingerprint: true } }),
  ]);
  const sales = await comboSales(combos);
  // Regla del usuario 2026-09-23: un combo solo lleva productos con su ID
  // real de Dropi — los que no lo tienen no entran al armado.
  const catalogById = new Map(catalog.filter((c) => c.justCode?.trim()).map((c) => [c.id, c]));

  // Ganadores: productos (cortes/Kardex + ATOM) y combos registrados.
  const winners = new Map<string, Candidate>();
  const addItemWinner = (id: string) => {
    const item = catalogById.get(id);
    if (!item || winners.has(`i:${id}`)) return;
    winners.set(`i:${id}`, { name: item.name, nicho: item.nicho, parts: [{ catalogItemId: id, quantity: 1, fromComboCode: null }], units7: out7.get(id) ?? 0, units30: out30.get(id) ?? 0 });
  };
  for (const [id, units30] of out30) if (isWinner(out7.get(id) ?? 0, units30)) addItemWinner(id);
  // ATOM detecta ventas que nunca tocan nuestra bodega (ej. Dropi directo) —
  // sigue sumando, como antes.
  const seenAtom = new Set<string>();
  for (const s of atomStatuses) {
    const id = s.matchedCatalogItemId as string;
    if (seenAtom.has(id)) continue;
    seenAtom.add(id);
    addItemWinner(id);
  }
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

  // Ganadores que ya tienen suficientes sugerencias abiertas no se repiten.
  const openByWinner = new Map(openRows.map((r) => [r.winnerCatalogItemId, r._count._all]));
  const winnerList = [...winners.values()].filter((w) => (openByWinner.get(w.parts[0].catalogItemId) ?? 0) < MAX_OPEN_PER_WINNER);

  // Baja salida: todo lo que tiene stock en bodega y salió menos de 8 en 7
  // días (incluye los que salieron 0), más la lista manual de Daniel.
  const winnerItemIds = new Set([...winners.values()].flatMap((w) => w.parts.map((p) => p.catalogItemId)));
  const lowUnits = new Map<string, number>();
  for (const b of latestBalances) {
    const units = out7.get(b.catalogItemId) ?? 0;
    if (b.balanceAfter > 0 && units < LOW_ROTATION_THRESHOLD) lowUnits.set(b.catalogItemId, units);
  }
  const manualSeen = new Set<string>();
  for (const e of lowRotationEntries) {
    if (manualSeen.has(e.catalogItemId)) continue; // solo su semana más reciente
    manualSeen.add(e.catalogItemId);
    if (e.unitsDispatched < LOW_ROTATION_THRESHOLD && !lowUnits.has(e.catalogItemId)) lowUnits.set(e.catalogItemId, e.unitsDispatched);
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
  const results = await Promise.all(chunks.map((chunk) => askAi(chunk, lowList, actorId)));

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
            suggestedName: ai.name,
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
};

export async function priceCombos(list: { id: string; parts: { catalogItemId: string; quantity: number }[] }[]): Promise<Map<string, ComboPricing>> {
  const ids = [...new Set(list.flatMap((c) => c.parts.map((p) => p.catalogItemId)))];
  const [costBasis, stock] = await Promise.all([resolveCostBasisForCatalogItems(ids), getCurrentStockByItemIds(ids)]);
  const out = new Map<string, ComboPricing>();
  for (const c of list) {
    const missing = c.parts.filter((p) => !costBasis.has(p.catalogItemId)).map((p) => p.catalogItemId);
    let dropiPrice: number | null = null;
    let separatePrice: number | null = null;
    if (missing.length === 0 && c.parts.length > 0) {
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
