import { prisma } from "@/lib/prisma";
import { addGuidesLine, isRocketCode, normalizeName, parseGuidesPdf, ROCKET_PREFIX, type ParsedGuidesLine } from "@/lib/dropiGuidesPdf";
import { findSimilarUnlinkedItem, significantWords } from "@/lib/justCatalog";
import { getCurrentStockByItemIds } from "@/lib/stockKardex";
import { notifyOwner } from "@/lib/notifications";
import { getInventoryLeadId } from "@/lib/guards";
import { lineBlock, NO_CARRIER, sortCarriers, VARIANT_CARRIER_UNKNOWN } from "@/lib/carriers";
import { areaRank } from "@/lib/warehouseAreas";
import { guayaquilMonth, syncWarrantyMonth } from "@/lib/warrantyKpi";
import { linkProductsFromGuides } from "@/lib/storeTracking";

export const NO_BRAND = "SIN_MARCA";

// Confirmado 2026-09-23, diseño acordado con el usuario pregunta por
// pregunta (ver memoria project_fulfillment_corte_manifest_plan):
//   1. Yair sube los PDF de guías de cada corte → la app agrupa todo por el
//      ID MADRE de INVESTOCK (los IDs de Dropi/Rocket son "de promoción" y
//      apuntan a él), abre los combos, reparte por transportadora y separa
//      las garantías.
//   2. Aviso temprano: lo que no alcanza en stock se ve en rojo y, al
//      enviar, le llega a Bryan Ríos y a Jariel.
//   3. Yair envía el corte a Inventario con doble confirmación; desde ahí
//      el lote queda cerrado.
// Nada de esto mueve el stock: el Kardex se descuenta recién cuando Daniel
// confirma lo que su equipo de verdad sacó (siguiente parte).

const ITEM_SELECT = { id: true, name: true, photos: true, justCode: true, pendingRegistration: true } as const;
type ItemLite = { id: string; name: string; photos: string[]; justCode: string | null; pendingRegistration: boolean };

// Regla del usuario 2026-09-23 (caso real: "Pistola Hidrolavadora Con 2
// Baterias" estaba dentro del combo 113467 sin ID de Dropi): ninguna receta
// de combo se guarda con un producto que no tenga su ID real. Devuelve los
// nombres de los que faltan — vacío = todo bien.
export async function componentsMissingDropiId(catalogItemIds: string[]): Promise<string[]> {
  if (catalogItemIds.length === 0) return [];
  const items = await prisma.purchaseCatalogItem.findMany({ where: { id: { in: catalogItemIds } }, select: { name: true, justCode: true } });
  return items.filter((i) => !i.justCode?.trim()).map((i) => i.name);
}

export function missingDropiIdMessage(names: string[]): string {
  return `Estos productos no tienen ID de Dropi todavía: ${names.join(", ")}. Un combo solo puede llevar productos con su ID real — pide que se lo pongan en "Base de datos de productos" (o en Stock Actual) y vuelve a intentarlo.`;
}

export type GuideResolution =
  | { kind: "product"; catalogItem: ItemLite }
  | { kind: "combo"; comboCode: string; label: string | null; components: { catalogItem: ItemLite; quantity: number }[]; missingIds: string[] }
  | { kind: "comboNoRecipe"; comboCode: string }
  | { kind: "ignored"; label: string }
  // Producto dado de baja que igual se vendió en Dropi (DropiDiscontinuedSale).
  | { kind: "discontinued"; label: string }
  | { kind: "unknown"; suggestion: ItemLite | null };

export type ResolvedGuideLine = ParsedGuidesLine & { resolution: GuideResolution };

const COMBO_SELECT = { code: true, label: true, components: { select: { quantity: true, catalogItem: { select: ITEM_SELECT } } } } as const;
type ComboLite = { code: string; label: string | null; components: { quantity: number; catalogItem: ItemLite }[] };

function comboResolution(combo: ComboLite): GuideResolution {
  if (combo.components.length === 0) return { kind: "comboNoRecipe", comboCode: combo.code };
  return {
    kind: "combo",
    comboCode: combo.code,
    label: combo.label,
    components: combo.components.map((c) => ({ catalogItem: c.catalogItem, quantity: c.quantity })),
    missingIds: combo.components.filter((c) => !c.catalogItem.justCode?.trim()).map((c) => c.catalogItem.name),
  };
}

// Combo de Dropi por su código — para que Yair vincule un ID de Rocket a un
// combo que ya existe (confirmado 2026-09-25: Rocket usa sus propios IDs).
export async function findComboByCode(code: string) {
  const combo = await prisma.dropiCombo.findUnique({ where: { code }, select: COMBO_SELECT });
  return combo ? { ...comboResolution(combo), label: combo.label } : null;
}

// skipSuggestions (2026-10-02): quien solo necesita saber a qué producto o
// combo corresponde cada código (garantías, reingreso por guía) no carga el
// catálogo entero para sugerir nombres — eso hacía lento cada escaneo.
export async function resolveGuideLines(lines: ParsedGuidesLine[], opts: { skipSuggestions?: boolean } = {}): Promise<ResolvedGuideLine[]> {
  // Los códigos de Rocket ("R14599") no son IDs de Dropi: se reconocen por
  // lo que Yair ya vinculó antes (RocketCodeMapping), nunca por justCode.
  const codes = lines.map((l) => l.code).filter((c) => !isRocketCode(c));
  const rocketCodes = lines.map((l) => l.code).filter(isRocketCode).map((c) => c.slice(ROCKET_PREFIX.length));
  const rocketMappings = await prisma.rocketCodeMapping.findMany({
    where: { rocketCode: { in: rocketCodes } },
    select: { rocketCode: true, catalogItem: { select: ITEM_SELECT }, dropiCombo: { select: COMBO_SELECT } },
  });
  const rocketByCode = new Map(rocketMappings.map((m) => [`${ROCKET_PREFIX}${m.rocketCode}`, m]));
  const [items, combos, ignored, discontinued, allItems] = await Promise.all([
    prisma.purchaseCatalogItem.findMany({ where: { justCode: { in: codes } }, select: ITEM_SELECT }),
    prisma.dropiCombo.findMany({ where: { code: { in: codes } }, select: COMBO_SELECT }),
    prisma.dropiIgnoredCode.findMany({ where: { code: { in: lines.map((l) => l.code) } }, select: { code: true, label: true } }),
    prisma.dropiDiscontinuedSale.findMany({ where: { code: { in: lines.map((l) => l.code) } }, select: { code: true, name: true }, distinct: ["code"] }),
    // Candidatos para sugerir cuando el código es nuevo. Confirmado con
    // datos reales 2026-09-23: Dropi tiene VARIOS IDs para el mismo
    // producto físico (ej. Pistola de Soldar 118388 y 112139, Licuadora
    // Potente 123676 y 125399), así que se busca en todo el catálogo — los
    // que aún no tienen ID primero (caso pistola hidrolavadora).
    opts.skipSuggestions ? Promise.resolve([]) : prisma.purchaseCatalogItem.findMany({ select: ITEM_SELECT, orderBy: { justCode: { sort: "asc", nulls: "first" } } }),
  ]);
  const itemByCode = new Map(items.map((i) => [i.justCode!, i]));
  const comboByCode = new Map(combos.map((c) => [c.code, c]));
  const ignoredByCode = new Map(ignored.map((i) => [i.code, i.label]));
  const discontinuedByCode = new Map(discontinued.map((d) => [d.code, d.name]));
  const unlinked = allItems.filter((u) => !u.justCode);
  const unlinkedNorm = unlinked.map((u) => ({ item: u, norm: normalizeName(u.name) }));
  const allNorm = allItems.map((u) => ({ item: u, norm: normalizeName(u.name) }));
  const allWords = allItems.map((u) => ({ id: u.id, name: u.name, words: significantWords(u.name) }));

  return lines.map((l) => {
    const rocket = rocketByCode.get(l.code);
    if (rocket?.catalogItem) return { ...l, resolution: { kind: "product", catalogItem: rocket.catalogItem } };
    if (rocket?.dropiCombo) return { ...l, resolution: comboResolution(rocket.dropiCombo) };
    const item = isRocketCode(l.code) ? undefined : itemByCode.get(l.code);
    if (item) return { ...l, resolution: { kind: "product", catalogItem: item } };
    const combo = isRocketCode(l.code) ? undefined : comboByCode.get(l.code);
    if (combo) return { ...l, resolution: comboResolution(combo) };
    const ignoredLabel = ignoredByCode.get(l.code);
    if (ignoredLabel !== undefined) return { ...l, resolution: { kind: "ignored", label: ignoredLabel } };
    const discontinuedLabel = discontinuedByCode.get(l.code);
    if (discontinuedLabel !== undefined) return { ...l, resolution: { kind: "discontinued", label: discontinuedLabel } };

    // Dropi corta los nombres a ~40 caracteres, así que se acepta que uno
    // sea el comienzo del otro; si no, palabras en común (mismo criterio que
    // Base de datos de productos). Solo es SUGERENCIA — Yair confirma.
    const norm = normalizeName(l.name);
    const prefix = (u: { norm: string }) => norm.length >= 12 && (u.norm.startsWith(norm) || norm.startsWith(u.norm + " "));
    const hit =
      unlinkedNorm.find((u) => u.norm === norm)?.item ??
      allNorm.find((u) => u.norm === norm)?.item ??
      unlinkedNorm.find(prefix)?.item ??
      allNorm.find(prefix)?.item;
    const similar = hit ? null : findSimilarUnlinkedItem(significantWords(l.name), allWords);
    const suggestion = hit ?? (similar ? allItems.find((u) => u.id === similar.id) ?? null : null);
    return { ...l, resolution: { kind: "unknown", suggestion } };
  });
}

export async function findAlreadyUploadedGuides(numbers: string[]): Promise<{ number: string; requestedAt: Date }[]> {
  if (numbers.length === 0) return [];
  const found = await prisma.fulfillmentRequestGuide.findMany({
    where: { guideNumber: { in: numbers } },
    select: { guideNumber: true, batch: { select: { requestedAt: true } } },
  });
  return found.map((f) => ({ number: f.guideNumber, requestedAt: f.batch.requestedAt }));
}

// ---- Lote por corte -------------------------------------------------------

// Ecuador no tiene horario de verano: siempre UTC-5.
const EC_OFFSET_MS = 5 * 60 * 60 * 1000;

export function ecuadorDay(d: Date): string {
  return new Date(d.getTime() - EC_OFFSET_MS).toISOString().slice(0, 10);
}

// El corte abierto (DRAFT) de hoy. Si no hay (nunca se subió nada hoy, o
// el último ya se envió), se abre el siguiente: Corte 1, 2, 3…
export async function getOrCreateOpenLot(): Promise<{ id: string; corte: number }> {
  const day = ecuadorDay(new Date());
  for (let attempt = 0; attempt < 3; attempt++) {
    const open = await prisma.fulfillmentLot.findFirst({ where: { day, status: "DRAFT" }, orderBy: { corte: "desc" }, select: { id: true, corte: true } });
    if (open) return open;
    const last = await prisma.fulfillmentLot.findFirst({ where: { day }, orderBy: { corte: "desc" }, select: { corte: true } });
    try {
      return await prisma.fulfillmentLot.create({ data: { day, corte: (last?.corte ?? 0) + 1 }, select: { id: true, corte: true } });
    } catch {
      // Dos subidas al mismo tiempo: la otra ya creó este corte — se reintenta.
    }
  }
  throw new Error("No se pudo abrir el corte de hoy — vuelve a intentar.");
}

// ---- Manifiesto atrasado (pedido del usuario 2026-09-29) -------------------
// Manifiestos de días pasados que nunca se cargaron (la semana del 21/09,
// cuando recién se probaba). Yair los sube con la fecha real del manifiesto:
// quedan en un corte de ESE día, ya enviado a Inventario, y Daniel los
// confirma de un clic ("ya salió todo") — sin escanear, porque la
// mercadería ya no está en bodega. Se reconoce sin columna nueva: un corte
// atrasado es uno creado después de su día.
// El usuario pidió que sea SOLO por esta vez: la opción existe únicamente
// para los manifiestos del 21 al 25/09. Cualquier otro día no la ve.
export const BACKFILL_FROM_DAY = "2026-09-21";
export const BACKFILL_TO_DAY = "2026-09-25";

// Cerrado 2026-10-02 (pedido del usuario): eso fue solo de prueba — todo
// manifiesto se sube el mismo día, en tiempo real. Ningún día admite ya la
// carga atrasada; los cortes atrasados que ya existen se siguen mostrando.
export function isBackfillDay(day: string): boolean {
  void day;
  return false;
}

export function isBackfillLot(lot: { day: string; createdAt: Date }): boolean {
  return ecuadorDay(lot.createdAt) > lot.day;
}

export function backfillDayError(day: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return "No se pudo leer la fecha del manifiesto.";
  if (!isBackfillDay(day)) return "Ya no se cargan manifiestos atrasados: cada manifiesto se sube el mismo día que sale.";
  return null;
}

// Si ese día ya tiene un corte atrasado sin confirmar, la nueva subida se
// suma ahí; si no, se abre el siguiente número de corte de ese día.
async function getOrCreateBackfillLot(day: string, userId: string | null): Promise<{ id: string; corte: number }> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const open = await prisma.fulfillmentLot.findMany({
      where: { day, status: "SENT", picks: { none: { confirmedAt: { not: null } } } },
      orderBy: { corte: "desc" },
      select: { id: true, corte: true, day: true, createdAt: true },
    });
    const reuse = open.find(isBackfillLot);
    if (reuse) return { id: reuse.id, corte: reuse.corte };
    const last = await prisma.fulfillmentLot.findFirst({ where: { day }, orderBy: { corte: "desc" }, select: { corte: true } });
    try {
      return await prisma.fulfillmentLot.create({ data: { day, corte: (last?.corte ?? 0) + 1, status: "SENT", sentAt: new Date(), sentById: userId }, select: { id: true, corte: true } });
    } catch {
      // Dos subidas al mismo tiempo — se reintenta.
    }
  }
  throw new Error("No se pudo abrir el corte atrasado — vuelve a intentar.");
}

// ---- Guardar la lectura del PDF -----------------------------------------

// comboCode: el combo de Dropi que corresponde. Para un código de Dropi es
// el mismo código; para uno de Rocket, el combo de Dropi al que Yair lo vinculó.
// ignore + discontinued: producto dado de baja que igual se vendió en Dropi
// (pedido del usuario 2026-09-30) — no sale, no toca stock, se avisa.
// perUnit: unidades del ID madre por cada pedido de este ID de Dropi (pack
// "X3" = 3) — solo para un ID alterno; sin él es 1.
type Decision = { kind: "product"; catalogItemId: string; perUnit?: number } | { kind: "combo"; comboCode?: string } | { kind: "ignore"; discontinued?: boolean };

export type GuidesApplyRow = {
  code: string;
  name: string;
  quantity: number;
  byCarrier: Record<string, number>;
  labelUnits: number;
  variants: { label: string; quantity: number; byCarrier?: Record<string, number> }[];
  // Ver ParsedGuidesLine.labelUnitsByCarrier — falta en borradores viejos.
  labelUnitsByCarrier?: Record<string, number>;
  decision: Decision;
};

export type WarrantyDecision =
  | { mode: "COMPLETE" }
  // Solo algunos productos del combo — ids de los que SÍ salen.
  | { mode: "PARTIAL"; catalogItemIds: string[] }
  // Solo una pieza: de qué producto es y qué pieza (sale del stock de
  // repuestos aparte, nunca del Kardex del producto).
  | { mode: "PIECE"; catalogItemId: string; piece: string };

// reason: motivo de la garantía (pedido del usuario 2026-09-30) — nombre de
// un WarrantyCategory existente o uno nuevo que se crea al guardar. De ahí
// sale solo el KPI de Garantías.
export type GuidesApplyWarranty = { guide: string; carrier: string; code: string; quantity: number; variant: string | null; decision: WarrantyDecision; reason: string };

export type GuidesApplyInput = {
  fileUrls: string[];
  // Lo que no se pudo leer bien (se le mostró a Yair) — queda guardado.
  parseWarnings?: string[];
  manifestDate: string | null;
  guides: { number: string; carrier: string; codes?: string[]; sender?: string | null }[];
  rows: GuidesApplyRow[];
  warranty: GuidesApplyWarranty[];
  // Manifiesto atrasado: el día real del manifiesto (ver getOrCreateBackfillLot).
  backfillDay?: string | null;
};

export type GuidesApplyResult = { ok: true; batchId: string; lotId: string; discontinuedCount: number } | { ok: false; error: string };

// Desglose de variantes de UNA fila del PDF: lo que se leyó en las
// etiquetas + lo que quedó sin variante + lo que no se alcanzó a leer. Suma
// siempre exactamente `quantity` (así cuadra con la validación de
// saveVariantNotes). Vacío si la fila no trae ninguna variante.
// Corte MF-0019 (2026-10-01, Daniel): el desglose iba entero en la primera
// transportadora y las demás recibían OTRA VEZ su "Sin variante" — la suma
// salía mayor que el pedido (Funda de zapatos: 9 pedidas, 12 en variantes).
// Ahora cada transportadora lleva solo las variantes leídas en SUS guías.
// Lo leído sin guía conocida ("") se acomoda donde todavía falte. Null si
// la fila no trae transportadora por variante (borrador anterior).
function rowBreakdownByCarrier(row: GuidesApplyRow): Map<string, { label: string; quantity: number }[]> | null {
  if (!row.labelUnitsByCarrier || row.variants.some((v) => !v.byCarrier)) return null;
  const out = new Map<string, { label: string; quantity: number }[]>();
  if (rowBreakdown(row).length === 0) return out;
  const carriers = Object.entries(row.byCarrier).filter(([, q]) => q > 0);
  const per = new Map(carriers.map(([c, q]) => [c, { quantity: q, labelUnits: row.labelUnitsByCarrier![c] ?? 0, variants: new Map<string, number>() }]));
  const loose: { label: string | null; quantity: number }[] = [];
  for (const v of row.variants) {
    for (const [c, q] of Object.entries(v.byCarrier!)) {
      const t = per.get(c);
      if (t) t.variants.set(v.label, (t.variants.get(v.label) ?? 0) + q);
      else loose.push({ label: v.label, quantity: q });
    }
  }
  const knownVariant = (c: string) => row.variants.reduce((s, v) => s + (v.byCarrier![c] ?? 0), 0);
  for (const [c, q] of Object.entries(row.labelUnitsByCarrier)) {
    if (per.has(c)) continue;
    const plain = q - knownVariant(c);
    if (plain > 0) loose.push({ label: null, quantity: plain });
  }
  for (const l of loose) {
    let left = l.quantity;
    for (const t of per.values()) {
      const room = t.quantity - t.labelUnits;
      if (left === 0 || room <= 0) continue;
      const q = Math.min(room, left);
      t.labelUnits += q;
      if (l.label) t.variants.set(l.label, (t.variants.get(l.label) ?? 0) + q);
      left -= q;
    }
  }
  for (const [c, t] of per) {
    const variants = [...t.variants].map(([label, quantity]) => ({ label, quantity }));
    const b = variants.length > 0 ? rowBreakdown({ variants, quantity: t.quantity, labelUnits: t.labelUnits }) : [];
    // Sin variantes en esta transportadora: todo lo suyo es "Sin variante"
    // (o "Sin leer" si no se alcanzó a leer su etiqueta).
    const read = Math.min(t.labelUnits, t.quantity);
    out.set(c, b.length > 0 ? b : [...(read > 0 ? [{ label: "Sin variante", quantity: read }] : []), ...(t.quantity - read > 0 ? [{ label: "Sin leer en guías", quantity: t.quantity - read }] : [])]);
  }
  return out;
}

// Pedido del usuario 2026-09-28 (temporal): ID provisional de ALF.
export const isProvisionalAlfName = (name: string) => /-\s*ALF\s*$/i.test(name.trim());

function rowBreakdown(row: Pick<GuidesApplyRow, "variants" | "quantity" | "labelUnits">): { label: string; quantity: number }[] {
  const variants = row.variants.filter((v) => v.label.trim() && v.quantity > 0);
  if (variants.length === 0 || row.quantity === 0) return [];
  const read = variants.reduce((s, v) => s + v.quantity, 0);
  if (read > row.quantity) return [];
  const labeled = Math.min(row.labelUnits, row.quantity);
  const withoutVariant = Math.max(0, labeled - read);
  const unread = row.quantity - read - withoutVariant;
  return [
    ...variants,
    ...(withoutVariant > 0 ? [{ label: "Sin variante", quantity: withoutVariant }] : []),
    ...(unread > 0 ? [{ label: "Sin leer en guías", quantity: unread }] : []),
  ];
}

type ItemRow = {
  catalogItemId: string;
  quantity: number;
  sourceCode: string;
  fromComboCode: string | null;
  carrier: string | null;
  warrantyGuide?: string;
  warrantyMode?: string;
  warrantyPiece?: string;
  warrantyCategoryId?: string;
  breakdown: { label: string; quantity: number }[];
};

export async function applyGuidesImport(input: GuidesApplyInput, userId: string | null): Promise<GuidesApplyResult> {
  const dup = await findAlreadyUploadedGuides(input.guides.map((g) => g.number));
  if (dup.length > 0) {
    return { ok: false, error: `${dup.length} guía(s) de este PDF ya se subieron antes (ej. ${dup[0].number}) — no se vuelven a sumar.` };
  }

  // Motivo de cada garantía: obligatorio. Se reutiliza la categoría con el
  // mismo nombre (sin importar mayúsculas) o se crea una nueva.
  const missingReason = input.warranty.find((w) => !w.reason?.trim());
  if (missingReason) return { ok: false, error: `Garantía ${missingReason.guide}: elige el motivo.` };
  const categoryIdByReason = new Map<string, string>();
  if (input.warranty.length > 0) {
    const existingCategories = await prisma.warrantyCategory.findMany({ select: { id: true, name: true } });
    const byLower = new Map(existingCategories.map((c) => [c.name.trim().toLowerCase(), c.id]));
    for (const reason of new Set(input.warranty.map((w) => w.reason.trim()))) {
      let id = byLower.get(reason.toLowerCase());
      if (!id) {
        id = (await prisma.warrantyCategory.upsert({ where: { name: reason }, create: { name: reason }, update: {} })).id;
        byLower.set(reason.toLowerCase(), id);
      }
      categoryIdByReason.set(reason, id);
    }
  }

  const decisionByCode = new Map(input.rows.map((r) => [r.code, r.decision]));
  const comboCodeOf = (r: GuidesApplyRow) => (r.decision.kind === "combo" ? r.decision.comboCode ?? r.code : null);
  // Rocket: lo que Yair confirma se guarda como vínculo ID de Rocket → producto/combo
  // (RocketCodeMapping) — nunca toca el ID de Dropi del catálogo.
  const rocketRows = input.rows.filter((r) => isRocketCode(r.code) && r.decision.kind !== "ignore");
  const productRows = input.rows.filter((r) => r.decision.kind === "product" && !isRocketCode(r.code));
  // Un combo que solo existe en Rocket se guarda con su código "R…" (ver
  // api/fulfillment-requests/rocket-combo), así que también se busca.
  const comboCodes = [...new Set(input.rows.map(comboCodeOf).filter((c): c is string => !!c))];
  // IDs provisionales de ALF (pedido del usuario 2026-09-28, temporal): no
  // tocan INVESTOCK, pero sí salen en el corte y en la hoja de despacho.
  const provisionalRows = input.rows.filter((r) => r.decision.kind === "ignore" && isProvisionalAlfName(r.name) && r.quantity > 0);
  const isDiscontinued = (r: GuidesApplyRow) => r.decision.kind === "ignore" && !!r.decision.discontinued && !isProvisionalAlfName(r.name);
  const discontinuedRows = input.rows.filter(isDiscontinued);
  const ignoreRows = input.rows.filter((r) => r.decision.kind === "ignore" && !isProvisionalAlfName(r.name) && !isDiscontinued(r));
  const discontinuedSales = discontinuedRows.map((r) => ({
    code: r.code,
    name: r.name,
    quantity: r.quantity,
    guideNumbers: input.guides.filter((g) => g.codes?.includes(r.code)).map((g) => g.number),
    carriers: Object.entries(r.byCarrier)
      .filter(([, q]) => q > 0)
      .map(([carrier, q]) => `${carrier} ${q}`),
    reportedById: userId,
  }));
  const provisionalLines = provisionalRows.flatMap((r) => {
    const variants = rowBreakdown(r).map((b) => `${b.label} ${b.quantity}`).join(" · ") || null;
    return Object.entries(r.byCarrier)
      .filter(([, q]) => q > 0)
      .map(([carrier, quantity], idx) => ({ code: r.code, name: r.name, quantity, carrier, variants: idx === 0 ? variants : null }));
  });

  const pickedIds = [...new Set(productRows.map((r) => (r.decision as { catalogItemId: string }).catalogItemId))];
  const [pickedItems, combos, codeOwners] = await Promise.all([
    prisma.purchaseCatalogItem.findMany({
      where: { id: { in: [...new Set([...pickedIds, ...rocketRows.flatMap((r) => (r.decision.kind === "product" ? [r.decision.catalogItemId] : []))])] } },
      select: { id: true, name: true, justCode: true },
    }),
    prisma.dropiCombo.findMany({
      where: { code: { in: comboCodes } },
      select: { id: true, code: true, components: { select: { catalogItemId: true, quantity: true, catalogItem: { select: { name: true, justCode: true } } } } },
    }),
    prisma.purchaseCatalogItem.findMany({ where: { justCode: { in: productRows.map((r) => r.code) } }, select: { id: true, name: true, justCode: true } }),
  ]);
  const itemById = new Map(pickedItems.map((i) => [i.id, i]));
  const comboByCode = new Map(combos.map((c) => [c.code, c]));
  const ownerByCode = new Map(codeOwners.map((o) => [o.justCode!, o]));

  // Qué hay que "aprender" de esta subida.
  const assignCode: { itemId: string; code: string }[] = [];
  const aliasCombos: { code: string; label: string; itemId: string; quantity: number }[] = [];

  for (const row of productRows) {
    const item = itemById.get((row.decision as { catalogItemId: string }).catalogItemId);
    if (!item) return { ok: false, error: `No se encontró el producto elegido para el código ${row.code}.` };
    const perUnit = (row.decision as { perUnit?: number }).perUnit ?? 1;
    if (item.justCode === row.code) {
      if (perUnit > 1) return { ok: false, error: `${row.code} es el ID madre de "${item.name}" — no puede valer ${perUnit} unidades.` };
      continue;
    }
    const owner = ownerByCode.get(row.code);
    if (owner && owner.id !== item.id) return { ok: false, error: `El código ${row.code} ya pertenece a "${owner.name}" — elige ese producto.` };
    if (!item.justCode && perUnit > 1) {
      // Un pack no puede volverse el ID madre: primero el producto suelto
      // necesita su propio ID de Dropi.
      return { ok: false, error: `${row.code} es un pack de ${perUnit}: primero ponle su ID de Dropi a "${item.name}" en Stock Actual o Base de datos de productos.` };
    }
    if (!item.justCode) {
      // El producto no tenía ID de Dropi: se le pone este — es lo que la
      // app "aprende" para no volver a preguntar.
      assignCode.push({ itemId: item.id, code: row.code });
    } else {
      // Confirmado por el usuario 2026-09-23: Dropi publica el mismo
      // producto con varios IDs ("de promoción"), pero en INVESTOCK existe
      // uno solo — se guarda como ID alterno (combo 1:1), nunca se pisa el
      // ID madre. Si es un pack ("X3", confirmado al subir), la receta
      // lleva esa cantidad (pedido del usuario 2026-10-01).
      aliasCombos.push({ code: row.code, label: row.name, itemId: item.id, quantity: perUnit });
    }
  }
  if (new Set(assignCode.map((a) => a.itemId)).size !== assignCode.length) {
    return { ok: false, error: "Elegiste el mismo producto para dos códigos distintos de Dropi — revisa las filas." };
  }

  for (const r of rocketRows) {
    if (r.decision.kind === "product" && !itemById.has(r.decision.catalogItemId)) return { ok: false, error: `No se encontró el producto elegido para ${r.name}.` };
  }

  for (const code of comboCodes) {
    const combo = comboByCode.get(code);
    if (!combo || combo.components.length === 0) return { ok: false, error: `El combo ${code} todavía no tiene receta registrada.` };
    const missing = combo.components.filter((c) => !c.catalogItem.justCode?.trim()).map((c) => c.catalogItem.name);
    if (missing.length > 0) return { ok: false, error: `Combo ${code}: ${missingDropiIdMessage(missing)}` };
  }

  // Lo que se pide por código, ya en productos reales (ID madre).
  const expand = (code: string): { catalogItemId: string; perUnit: number; fromCombo: string | null }[] | null => {
    const d = decisionByCode.get(code);
    if (!d || d.kind === "ignore") return null;
    if (d.kind === "product") {
      // Un pack recién vinculado ya sale como el combo que se va a crear.
      const perUnit = d.perUnit ?? 1;
      return [{ catalogItemId: d.catalogItemId, perUnit, fromCombo: perUnit > 1 ? code : null }];
    }
    const comboCode = d.comboCode ?? code;
    return comboByCode.get(comboCode)!.components.map((c) => ({ catalogItemId: c.catalogItemId, perUnit: c.quantity, fromCombo: comboCode }));
  };

  const itemRows: ItemRow[] = [];
  for (const row of input.rows) {
    const parts = expand(row.code);
    if (!parts || row.quantity === 0) continue;
    const breakdown = rowBreakdown(row);
    const byCarrierBreakdown = rowBreakdownByCarrier(row);
    for (const part of parts) {
      const carriers = Object.entries(row.byCarrier).filter(([, q]) => q > 0);
      carriers.forEach(([carrier, q], idx) => {
        itemRows.push({
          catalogItemId: part.catalogItemId,
          quantity: q * part.perUnit,
          sourceCode: row.code,
          fromComboCode: part.fromCombo,
          carrier,
          // Cada transportadora con su propio desglose; en borradores viejos
          // (sin transportadora por variante) va una sola vez, en la primera.
          breakdown: (byCarrierBreakdown ? byCarrierBreakdown.get(carrier) ?? [] : idx === 0 ? breakdown : []).map((b) => ({
            label: part.fromCombo ? `Combo ${part.fromCombo}: ${b.label}` : b.label,
            quantity: b.quantity * part.perUnit,
          })),
        });
      });
    }
  }

  // Garantías: Yair ya dijo qué sale de verdad en cada una.
  for (const w of input.warranty) {
    const parts = expand(w.code);
    if (!parts) continue;
    const d = w.decision;
    if (d.mode === "PIECE") {
      if (!parts.some((p) => p.catalogItemId === d.catalogItemId)) return { ok: false, error: `Garantía ${w.guide}: la pieza debe ser de uno de los productos de esa guía.` };
      if (!d.piece.trim()) return { ok: false, error: `Garantía ${w.guide}: escribe qué pieza sale.` };
      itemRows.push({
        catalogItemId: d.catalogItemId,
        quantity: w.quantity,
        sourceCode: w.code,
        fromComboCode: parts[0].fromCombo,
        carrier: w.carrier,
        warrantyGuide: w.guide,
        warrantyMode: "PIECE",
        warrantyPiece: d.piece.trim(),
        warrantyCategoryId: categoryIdByReason.get(w.reason.trim()),
        breakdown: [],
      });
      continue;
    }
    const chosen = d.mode === "PARTIAL" ? parts.filter((p) => d.catalogItemIds.includes(p.catalogItemId)) : parts;
    if (d.mode === "PARTIAL" && chosen.length === 0) return { ok: false, error: `Garantía ${w.guide}: marca al menos un producto del combo que sale.` };
    for (const p of chosen) {
      itemRows.push({
        catalogItemId: p.catalogItemId,
        quantity: w.quantity * p.perUnit,
        sourceCode: w.code,
        fromComboCode: p.fromCombo,
        carrier: w.carrier,
        warrantyGuide: w.guide,
        warrantyMode: d.mode,
        // En COMPLETE/PARTIAL este campo guarda el color/talla de la guía.
        warrantyPiece: w.variant ?? undefined,
        warrantyCategoryId: categoryIdByReason.get(w.reason.trim()),
        breakdown: [],
      });
    }
  }

  if (itemRows.length === 0 && provisionalLines.length === 0 && discontinuedSales.length === 0) return { ok: false, error: "No hay ningún producto listo para guardar." };

  // Notas de variante por producto: solo si alguna de sus filas trae
  // variantes; las demás filas del mismo producto entran como "Sin
  // variante" para que la suma cuadre con el total.
  // Las garantías no entran: se ven aparte, con lo que Yair marcó.
  // Pedido de Daniel 2026-09-29: cada nota guarda también su transportadora
  // (un mismo PDF trae varias), para ver "Hombre 7 → Servientrega 6 ·
  // Gintracom 1" al sacar. El relleno "Sin variante" se calcula por
  // transportadora.
  const normalRows = itemRows.filter((r) => !r.warrantyGuide);
  const notesByItem = new Map<string, Map<string, Map<string, number>>>();
  const itemsWithVariants = new Set(normalRows.filter((r) => r.breakdown.length > 0).map((r) => r.catalogItemId));
  const totalByItem = new Map<string, Map<string, number>>();
  for (const r of normalRows) {
    if (!itemsWithVariants.has(r.catalogItemId)) continue;
    const carrier = r.carrier ?? NO_CARRIER;
    let t = totalByItem.get(r.catalogItemId);
    if (!t) totalByItem.set(r.catalogItemId, (t = new Map()));
    t.set(carrier, (t.get(carrier) ?? 0) + r.quantity);
    let byCarrier = notesByItem.get(r.catalogItemId);
    if (!byCarrier) notesByItem.set(r.catalogItemId, (byCarrier = new Map()));
    let m = byCarrier.get(carrier);
    if (!m) byCarrier.set(carrier, (m = new Map()));
    for (const p of r.breakdown) m.set(p.label, (m.get(p.label) ?? 0) + p.quantity);
  }
  for (const [itemId, byCarrier] of notesByItem) {
    const totals = totalByItem.get(itemId) ?? new Map<string, number>();
    // Nunca rellenar más allá del total del producto (un desglose viejo que
    // ya cubre todo en la primera transportadora no se vuelve a sumar).
    let itemGap = [...totals.values()].reduce((a, b) => a + b, 0) - [...byCarrier.values()].reduce((a, m) => a + [...m.values()].reduce((x, y) => x + y, 0), 0);
    for (const [carrier, total] of totals) {
      let m = byCarrier.get(carrier);
      if (!m) byCarrier.set(carrier, (m = new Map()));
      const noted = [...m.values()].reduce((a, b) => a + b, 0);
      const gap = Math.min(total - noted, itemGap);
      if (gap > 0) {
        m.set("Sin variante", (m.get("Sin variante") ?? 0) + gap);
        itemGap -= gap;
      }
    }
  }

  const backfillDay = input.backfillDay ?? null;
  if (backfillDay) {
    const dayErr = backfillDayError(backfillDay);
    if (dayErr) return { ok: false, error: dayErr };
  }
  const lot = backfillDay ? await getOrCreateBackfillLot(backfillDay, userId) : await getOrCreateOpenLot();

  try {
    const batch = await prisma.$transaction(async (tx) => {
      const fresh = await tx.fulfillmentLot.findUnique({ where: { id: lot.id }, select: { status: true, picks: { where: { confirmedAt: { not: null } }, select: { id: true }, take: 1 } } });
      const stillOpen = backfillDay ? fresh?.status === "SENT" && fresh.picks.length === 0 : fresh?.status === "DRAFT";
      if (!stillOpen) throw new Error("LOT_CLOSED");
      for (const a of assignCode) {
        await tx.purchaseCatalogItem.update({ where: { id: a.itemId }, data: { justCode: a.code } });
      }
      for (const a of aliasCombos) {
        await tx.dropiCombo.create({
          data: {
            code: a.code,
            label: a.quantity > 1 ? `${a.label} (pack de ${a.quantity})` : `${a.label} (ID alterno)`,
            createdById: userId,
            components: { create: [{ catalogItemId: a.itemId, quantity: a.quantity }] },
          },
        });
      }
      for (const r of rocketRows) {
        const rocketCode = r.code.slice(ROCKET_PREFIX.length);
        const target =
          r.decision.kind === "product"
            ? { catalogItemId: r.decision.catalogItemId, dropiComboId: null }
            : { catalogItemId: null, dropiComboId: comboByCode.get(comboCodeOf(r)!)!.id };
        await tx.rocketCodeMapping.upsert({
          where: { rocketCode },
          create: { rocketCode, rocketName: r.name, createdById: userId, ...target },
          update: { rocketName: r.name, ...target },
        });
      }
      for (const r of ignoreRows) {
        await tx.dropiIgnoredCode.upsert({ where: { code: r.code }, create: { code: r.code, label: r.name, createdById: userId }, update: { label: r.name } });
      }
      return tx.fulfillmentRequestBatch.create({
        data: {
          source: input.rows.every((r) => isRocketCode(r.code)) ? "ROCKET" : "DROPI",
          requestedById: userId,
          lotId: lot.id,
          totalRows: input.rows.length,
          skippedCount: ignoreRows.length + discontinuedRows.length,
          fileUrls: input.fileUrls,
          manifestDate: input.manifestDate,
          parseWarnings: input.parseWarnings ?? [],
          items: {
            create: itemRows.map((r) => ({
              catalogItemId: r.catalogItemId,
              quantity: r.quantity,
              sourceCode: r.sourceCode,
              fromComboCode: r.fromComboCode,
              carrier: r.carrier,
              warrantyGuide: r.warrantyGuide ?? null,
              warrantyMode: r.warrantyMode ?? null,
              warrantyPiece: r.warrantyPiece ?? null,
              warrantyCategoryId: r.warrantyCategoryId ?? null,
            })),
          },
          guides: { create: input.guides.map((g) => ({ guideNumber: g.number, carrier: g.carrier, codes: g.codes ?? [], sender: g.sender ?? null })) },
          provisionalLines: { create: provisionalLines },
          discontinuedSales: { create: discontinuedSales },
          variantNotes: {
            create: [...notesByItem.entries()].flatMap(([catalogItemId, byCarrier]) =>
              [...byCarrier.entries()].flatMap(([carrier, m]) =>
                [...m.entries()].map(([label, quantity]) => ({ catalogItemId, carrier: carrier === NO_CARRIER ? null : carrier, label, quantity, createdById: userId }))
              )
            ),
          },
        },
      });
    });
    // KPI de Garantías automático: se recalcula el mes con lo recién subido.
    if (input.warranty.length > 0) await syncWarrantyMonth(guayaquilMonth(new Date())).catch(() => null);
    // Seguimiento de tiendas: cada ID de Shanghai queda vinculado a la tienda
    // que dice su etiqueta (nunca frena la subida).
    await linkProductsFromGuides(input.guides).catch(() => null);
    return { ok: true, batchId: batch.id, lotId: lot.id, discontinuedCount: discontinuedSales.length };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg === "LOT_CLOSED" && backfillDay) return { ok: false, error: "Daniel acaba de confirmar ese corte atrasado — vuelve a guardar y entrará en uno nuevo del mismo día." };
    if (msg === "LOT_CLOSED") return { ok: false, error: "El corte se acaba de enviar a Inventario — vuelve a guardar y entrará al corte siguiente." };
    if (msg.includes("Unique constraint")) {
      return { ok: false, error: "Otra persona acaba de subir alguna de estas guías o de registrar uno de estos códigos — vuelve a leer el PDF." };
    }
    throw e;
  }
}

// ---- Ver un corte --------------------------------------------------------

// area: área de la bodega (A…G) donde está el producto — ver warehouseAreas.ts.
type ItemView = { catalogItemId: string; name: string; photos: string[]; justCode: string | null; area?: string | null };

export type LotLine = ItemView & {
  quantity: number;
  byCarrier: Record<string, number>;
  // 2026-09-25: de qué combos salen estas unidades, para que Yair vea si una
  // receta mal armada le está sumando de más.
  fromCombos: { code: string; quantity: number }[];
  // byCarrier: cuántas de esa variante van por cada transportadora.
  variants: { label: string; quantity: number; byCarrier: Record<string, number> }[];
};
// Producto con ID provisional de ALF: no está en INVESTOCK (sin foto, sin QR).
export type ProvisionalLotLine = { code: string; name: string; quantity: number; byCarrier: Record<string, number>; variants: string[] };
export type LotWarrantyLine = ItemView & {
  itemId: string;
  guide: string;
  carrier: string;
  quantity: number;
  mode: string;
  piece: string | null;
  fromComboCode: string | null;
  pieceConfirmedAt: Date | null;
};
// pendingReturns: unidades buenas de ese producto que YA llegaron a bodega
// (devoluciones / guías canceladas) pero todavía no entraron a INVESTOCK —
// Daniel puede ingresarlas antes de sacar la mercadería (pedido del usuario
// 2026-09-25). realShortage = lo que falta aun contando esas devoluciones.
export type LotShortage = ItemView & { needed: number; stock: number; pendingReturns: { label: string; qty: number }[]; realShortage: number };

// Devoluciones que ya llegaron pero todavía no suman en INVESTOCK:
//   - Reingresos (RM-…) enviados que esperan la aprobación de Daniel, o
//     que el equipo todavía está capturando.
//   - Guías canceladas (GC-…) que siguen sin reingresar.
export async function pendingReturnsByItem(catalogItemIds: string[]): Promise<Map<string, { label: string; qty: number }[]>> {
  const out = new Map<string, { label: string; qty: number }[]>();
  if (catalogItemIds.length === 0) return out;
  const push = (id: string, label: string, qty: number) => {
    if (qty <= 0) return;
    const list = out.get(id) ?? [];
    const same = list.find((x) => x.label === label);
    if (same) same.qty += qty;
    else list.push({ label, qty });
    out.set(id, list);
  };
  const [reentry, cancelled] = await Promise.all([
    prisma.merchandiseReentryItem.findMany({
      where: { catalogItemId: { in: catalogItemIds }, goodQty: { gt: 0 }, batch: { danielApprovedAt: null, closedAt: null } },
      select: { catalogItemId: true, goodQty: true, batch: { select: { code: true, submittedAt: true } } },
    }),
    prisma.cancelledGuideItem.findMany({
      where: { catalogItemId: { in: catalogItemIds }, report: { reingresadoAt: null, NOT: { reallyCancelled: false } } },
      select: { catalogItemId: true, quantity: true, report: { select: { code: true } } },
    }),
  ]);
  for (const r of reentry) {
    push(r.catalogItemId!, r.batch.submittedAt ? `reingreso ${r.batch.code} esperando tu aprobación` : `reingreso ${r.batch.code} que el equipo aún está registrando`, r.goodQty);
  }
  for (const c of cancelled) push(c.catalogItemId!, `guía cancelada ${c.report.code} sin reingresar`, c.quantity);
  return out;
}
// Parte 3: por cada producto real del corte, lo pedido (normal + garantías
// que no son pieza) vs lo que el equipo registró al escanear y lo que
// Daniel confirmó.
export type LotPickLine = ItemView & {
  needed: number;
  normalNeeded: number;
  warrantyNeeded: number;
  picked: number | null;
  pickedByName: string | null;
  pickedAt: Date | null;
  confirmedQty: number | null;
  confirmedAt: Date | null;
  confirmedByName: string | null;
  // Bloque del manifiesto (transportadora que se va primero) — ver lineBlock.
  block: string;
};

export async function getCompiledLot(lotId: string) {
  const lot = await prisma.fulfillmentLot.findUnique({
    where: { id: lotId },
    include: {
      batches: {
        orderBy: { requestedAt: "asc" },
        include: {
          requestedBy: { select: { name: true } },
          items: { include: { catalogItem: { select: { id: true, name: true, photos: true, justCode: true, warehouseArea: true, bodega: true } } } },
          variantNotes: { select: { catalogItemId: true, carrier: true, label: true, quantity: true } },
          guides: { select: { guideNumber: true, carrier: true, codes: true } },
          provisionalLines: true,
          discontinuedSales: { select: { code: true, name: true, quantity: true, guideNumbers: true, carriers: true } },
        },
      },
      picks: true,
      blocks: true,
    },
  });
  if (!lot) return null;
  const personIds = [lot.sentById, lot.printedById, ...lot.picks.flatMap((p) => [p.pickedById, p.confirmedById]), ...lot.blocks.map((b) => b.assigneeId)].filter((x): x is string => !!x);
  const people = await prisma.user.findMany({ where: { id: { in: [...new Set(personIds)] } }, select: { id: true, name: true } });
  const nameOf = (id: string | null) => (id ? people.find((p) => p.id === id)?.name ?? "—" : null);

  const lines = new Map<string, LotLine & { variantMap: Map<string, { quantity: number; byCarrier: Record<string, number> }> }>();
  const warranty: LotWarrantyLine[] = [];
  const carriers = new Set<string>();
  for (const b of lot.batches) {
    for (const it of b.items) {
      const view: ItemView = { catalogItemId: it.catalogItemId, name: it.catalogItem.name, photos: it.catalogItem.photos, justCode: it.catalogItem.justCode, area: it.catalogItem.warehouseArea };
      if (it.warrantyGuide) {
        warranty.push({
          ...view,
          itemId: it.id,
          guide: it.warrantyGuide,
          carrier: it.carrier ?? NO_CARRIER,
          quantity: it.quantity,
          mode: it.warrantyMode ?? "COMPLETE",
          piece: it.warrantyPiece,
          fromComboCode: it.fromComboCode,
          pieceConfirmedAt: it.pieceConfirmedAt,
        });
        // (piece = pieza en modo PIECE; en los demás, el color/talla de la guía)
        continue;
      }
      const carrier = it.carrier ?? NO_CARRIER;
      carriers.add(carrier);
      let line = lines.get(it.catalogItemId);
      if (!line) lines.set(it.catalogItemId, (line = { ...view, quantity: 0, byCarrier: {}, fromCombos: [], variants: [], variantMap: new Map() }));
      line.quantity += it.quantity;
      if (it.fromComboCode) {
        const fc = line.fromCombos.find((c) => c.code === it.fromComboCode);
        if (fc) fc.quantity += it.quantity;
        else line.fromCombos.push({ code: it.fromComboCode, quantity: it.quantity });
      }
      line.byCarrier[carrier] = (line.byCarrier[carrier] ?? 0) + it.quantity;
    }
    for (const v of b.variantNotes) {
      const line = lines.get(v.catalogItemId);
      if (!line) continue;
      // Notas guardadas antes del 2026-09-29 no traen transportadora: si en
      // ese PDF el producto iba por una sola, es esa; si iba por varias, no
      // se sabe (VARIANT_CARRIER_UNKNOWN).
      let carrier = v.carrier;
      if (!carrier) {
        const cs = new Set(b.items.filter((i) => i.catalogItemId === v.catalogItemId && !i.warrantyGuide).map((i) => i.carrier ?? NO_CARRIER));
        carrier = cs.size === 1 ? [...cs][0] : VARIANT_CARRIER_UNKNOWN;
      }
      let entry = line.variantMap.get(v.label);
      if (!entry) line.variantMap.set(v.label, (entry = { quantity: 0, byCarrier: {} }));
      entry.quantity += v.quantity;
      entry.byCarrier[carrier] = (entry.byCarrier[carrier] ?? 0) + v.quantity;
    }
  }

  // Pedido de Yair (2026-09-26): además de las unidades, cuántas guías
  // (paquetes) salen por transportadora, contadas de las guías que leyó el PDF.
  const guidesByCarrier: Record<string, number> = {};
  // Pedido de Daniel (2026-09-28): lo mismo separado por plataforma (Dropi y
  // Rocket imprimen su propio manifiesto por transportadora), para que el
  // equipo vea en la app cuántas guías trae cada manifiesto sin preguntarle
  // a Yair.
  const guidesBySource: Record<string, Record<string, number>> = {};
  // Y por marca (pedido de Daniel 2026-09-28, sí del usuario): cada guía
  // guarda los productos de su etiqueta; la marca sale de la "Marca" que
  // Daniel pone en Stock Actual (cada producto tiene una sola marca). Rocket
  // va aparte como su propio grupo: códigos con prefijo R o guía RKT….
  // Guías subidas antes de 2026-09-28 no tienen productos guardados.
  const brandByCode = new Map<string, string>();
  // Un combo cuenta en la marca del combo, que la app aprende del manifiesto
  // en que viene (lib/manifestBrand.ts) — nunca la de sus productos, porque
  // un combo puede traer productos de otra marca.
  const lotComboCodes = [...new Set(lot.batches.flatMap((b) => b.items.map((i) => i.fromComboCode)).filter((c): c is string => !!c))];
  const lotCombos = lotComboCodes.length ? await prisma.dropiCombo.findMany({ where: { code: { in: lotComboCodes } }, select: { code: true, bodega: true } }) : [];
  for (const c of lotCombos) if (c.bodega) brandByCode.set(c.code, c.bodega);
  for (const b of lot.batches) {
    for (const it of b.items) {
      if (it.fromComboCode) continue;
      if (it.catalogItem.bodega && !brandByCode.has(it.sourceCode)) brandByCode.set(it.sourceCode, it.catalogItem.bodega);
    }
  }
  const guidesByBrand: Record<string, Record<string, number>> = {};
  let guidesWithCodes = 0;
  for (const b of lot.batches) {
    for (const g of b.guides) {
      guidesByCarrier[g.carrier] = (guidesByCarrier[g.carrier] ?? 0) + 1;
      const bySource = (guidesBySource[b.source] ??= {});
      bySource[g.carrier] = (bySource[g.carrier] ?? 0) + 1;
      if (g.codes.length > 0) guidesWithCodes++;
      const rocket = b.source === "ROCKET" || /^RKT/i.test(g.guideNumber) || g.codes.some(isRocketCode);
      const brand = rocket ? "ROCKET" : (g.codes.map((c) => brandByCode.get(c)).find(Boolean) ?? NO_BRAND);
      const byBrand = (guidesByBrand[brand] ??= {});
      byBrand[g.carrier] = (byBrand[g.carrier] ?? 0) + 1;
    }
  }

  // IDs provisionales de ALF (temporal, 2026-09-28): sumados por código.
  const provisionalMap = new Map<string, ProvisionalLotLine>();
  for (const b of lot.batches) {
    for (const p of b.provisionalLines) {
      let line = provisionalMap.get(p.code);
      if (!line) provisionalMap.set(p.code, (line = { code: p.code, name: p.name, quantity: 0, byCarrier: {}, variants: [] }));
      const carrier = p.carrier ?? NO_CARRIER;
      carriers.add(carrier);
      line.quantity += p.quantity;
      line.byCarrier[carrier] = (line.byCarrier[carrier] ?? 0) + p.quantity;
      if (p.variants) line.variants.push(p.variants);
    }
  }

  const lineList: LotLine[] = [...lines.values()].map(({ variantMap, ...l }) => {
    const variants = [...variantMap.entries()].filter(([label]) => label !== "Sin variante" || variantMap.size > 1).map(([label, v]) => ({ label, ...v }));
    return { ...l, variants: variants.sort((a, b) => b.quantity - a.quantity) };
  });

  // Aviso temprano de stock: lo pedido (normal + garantías que no son
  // pieza) contra el saldo actual de INVESTOCK.
  const needed = new Map<string, { view: ItemView; qty: number; normal: number; warranty: number }>();
  for (const l of lineList) needed.set(l.catalogItemId, { view: l, qty: l.quantity, normal: l.quantity, warranty: 0 });
  for (const w of warranty) {
    if (w.mode === "PIECE") continue;
    const cur = needed.get(w.catalogItemId);
    if (cur) {
      cur.qty += w.quantity;
      cur.warranty += w.quantity;
    } else needed.set(w.catalogItemId, { view: w, qty: w.quantity, normal: 0, warranty: w.quantity });
  }
  const pickByItem = new Map(lot.picks.map((p) => [p.catalogItemId, p]));
  const blockOf = (catalogItemId: string) => {
    const line = lineList.find((l) => l.catalogItemId === catalogItemId);
    if (line) return lineBlock(line.byCarrier);
    // Solo garantía: el bloque de la transportadora de esas guías.
    const byCarrier: Record<string, number> = {};
    for (const w of warranty) if (w.catalogItemId === catalogItemId) byCarrier[w.carrier] = (byCarrier[w.carrier] ?? 0) + w.quantity;
    return lineBlock(byCarrier);
  };
  const picking: LotPickLine[] = [...needed.values()].map(({ view, qty, normal, warranty: w }) => {
    const p = pickByItem.get(view.catalogItemId);
    return {
      catalogItemId: view.catalogItemId,
      name: view.name,
      photos: view.photos,
      justCode: view.justCode,
      area: view.area ?? null,
      needed: qty,
      normalNeeded: normal,
      warrantyNeeded: w,
      picked: p?.pickedQty ?? null,
      pickedByName: nameOf(p?.pickedById ?? null),
      pickedAt: p?.pickedAt ?? null,
      confirmedQty: p?.confirmedQty ?? null,
      confirmedAt: p?.confirmedAt ?? null,
      confirmedByName: nameOf(p?.confirmedById ?? null),
      block: blockOf(view.catalogItemId),
    };
  });
  // Un bloque por transportadora que manda en algún producto, con quién lo
  // tiene asignado (si Daniel ya lo asignó).
  const blocks = sortCarriers([...new Set(picking.map((p) => p.block))]).map((carrier) => {
    const a = lot.blocks.find((b) => b.carrier === carrier);
    return { carrier, assigneeId: a?.assigneeId ?? null, assigneeName: a ? nameOf(a.assigneeId) : null, assignedAt: a?.assignedAt ?? null };
  });
  // Manifiesto atrasado: si a un producto se le hizo un conteo físico DESPUÉS
  // del día del manifiesto (y antes de confirmarlo), ese conteo ya vio la
  // bodega sin esa mercadería — descontarla otra vez la restaría dos veces.
  // Esos productos se confirman sin tocar el Kardex (confirmBackfillLot).
  const backfill = isBackfillLot(lot);
  const countedAfter: (ItemView & { countedAt: Date })[] = [];
  if (backfill) {
    const counts = await prisma.stockKardexEntry.findMany({
      where: {
        type: "PHYSICAL_COUNT_ADJUSTMENT",
        catalogItemId: { in: [...needed.keys()] },
        occurredAt: { gt: new Date(`${lot.day}T23:59:59.999-05:00`), ...(lot.closedAt ? { lte: lot.closedAt } : {}) },
      },
      orderBy: { occurredAt: "desc" },
      select: { catalogItemId: true, occurredAt: true },
    });
    for (const c of counts) {
      if (countedAfter.some((x) => x.catalogItemId === c.catalogItemId)) continue;
      const view = needed.get(c.catalogItemId)!.view;
      countedAfter.push({ catalogItemId: view.catalogItemId, name: view.name, photos: view.photos, justCode: view.justCode, countedAt: c.occurredAt });
    }
  }
  const comboCodes = [...new Set(lot.batches.flatMap((b) => b.items.map((i) => i.fromComboCode)).filter((c): c is string => !!c))];
  const combos = await getComboRecipes(comboCodes);
  const stock = await getCurrentStockByItemIds([...needed.keys()]);
  const short = [...needed.values()].filter(({ view, qty }) => (stock.get(view.catalogItemId)?.balance ?? 0) < qty);
  const pending = await pendingReturnsByItem(short.map(({ view }) => view.catalogItemId));
  const shortages: LotShortage[] = short
    .map(({ view, qty }) => {
      const st = stock.get(view.catalogItemId)?.balance ?? 0;
      const pendingReturns = pending.get(view.catalogItemId) ?? [];
      const pendingQty = pendingReturns.reduce((a, p) => a + p.qty, 0);
      return {
        catalogItemId: view.catalogItemId,
        name: view.name,
        photos: view.photos,
        justCode: view.justCode,
        needed: qty,
        stock: st,
        pendingReturns,
        realShortage: Math.max(0, qty - Math.max(0, st) - pendingQty),
      };
    })
    .sort((a, b) => b.needed - b.stock - (a.needed - a.stock));

  return {
    id: lot.id,
    day: lot.day,
    corte: lot.corte,
    status: lot.status,
    sentAt: lot.sentAt,
    sentByName: nameOf(lot.sentById),
    manifestNumber: lot.manifestNumber,
    printedAt: lot.printedAt,
    printedByName: nameOf(lot.printedById),
    closedAt: lot.closedAt,
    backfill,
    countedAfter,
    carriers: sortCarriers([...carriers]),
    guidesByCarrier,
    guidesBySource,
    // Solo se muestra por marca si el corte trae guías con productos guardados.
    guidesByBrand: guidesWithCodes > 0 ? guidesByBrand : null,
    batches: lot.batches.map((b) => ({
      id: b.id,
      source: b.source,
      requestedAt: b.requestedAt,
      requestedByName: b.requestedBy?.name ?? "Administrador",
      guideCount: b.guides.length,
      fileCount: b.fileUrls.length,
    })),
    lines: lineList.sort((a, b) => b.quantity - a.quantity),
    provisional: [...provisionalMap.values()].sort((a, b) => b.quantity - a.quantity),
    // Productos dados de baja que igual se vendieron (2026-09-30): esas guías no salen.
    discontinued: lot.batches.flatMap((b) => b.discontinuedSales),
    warranty,
    combos,
    shortages,
    // Dentro de cada bloque, por área de bodega (A…G, sin área al final) y
    // luego de mayor a menor — así el equipo saca junto lo del mismo lugar.
    picking: picking.sort((a, b) => areaRank(a.area) - areaRank(b.area) || b.needed - a.needed),
    blocks,
    stockByItem: Object.fromEntries([...needed.keys()].map((id) => [id, stock.get(id)?.balance ?? 0])),
  };
}

export type CompiledLot = NonNullable<Awaited<ReturnType<typeof getCompiledLot>>>;

export async function listRecentLots() {
  const lots = await prisma.fulfillmentLot.findMany({
    orderBy: [{ day: "desc" }, { corte: "desc" }],
    take: 60,
    include: { batches: { select: { _count: { select: { guides: true } } } } },
  });
  // Pedido del usuario 2026-09-29: en "Otros cortes pendientes" Daniel ve de
  // un vistazo qué corte enviado quedó a medias — amarillo si falta asignar
  // algún bloque, rojo si hay productos sin escanear o con menos de lo pedido
  // (no se bajó todo). Solo se calcula para los enviados, que son pocos.
  const flags = new Map<string, { unassignedBlocks: number; unscanned: number }>();
  await Promise.all(
    lots
      // Un manifiesto atrasado no se escanea ni se asigna: ya salió.
      .filter((l) => l.status === "SENT" && !isBackfillLot(l))
      .map(async (l) => {
        const c = await getCompiledLot(l.id);
        if (!c) return;
        flags.set(l.id, {
          unassignedBlocks: c.blocks.filter((b) => !b.assigneeId).length,
          unscanned: c.picking.filter((p) => (p.picked ?? 0) < p.needed).length,
        });
      }),
  );
  return lots.map((l) => ({
    id: l.id,
    day: l.day,
    corte: l.corte,
    status: l.status,
    createdAt: l.createdAt,
    backfill: isBackfillLot(l),
    sentAt: l.sentAt,
    uploads: l.batches.length,
    guides: l.batches.reduce((s, b) => s + b._count.guides, 0),
    unassignedBlocks: flags.get(l.id)?.unassignedBlocks ?? 0,
    unscanned: flags.get(l.id)?.unscanned ?? 0,
  }));
}

// ---- Enviar a Inventario -------------------------------------------------

const LOT_URL = "/area/workspace?tab=egresos&otab=solicitud";

// Bryan Ríos (aprueba compras) + Jariel (hace las compras, Análisis de
// Mercado) — por permiso, no por nombre. canManagePurchases solo se toma
// dentro de MKT porque Nairoby (Finanzas) también lo tiene para facturar, y
// este aviso no es para ella.
export async function purchaseDeciderIds(): Promise<string[]> {
  const users = await prisma.user.findMany({
    where: { isActive: true, OR: [{ canApprovePurchaseRequests: true }, { canManagePurchases: true, purchasingNewRequestsBlocked: false, department: { code: "MKT" } }] },
    select: { id: true },
  });
  return users.map((u) => u.id);
}

export async function sendLotToInventory(lotId: string, userId: string | null): Promise<{ ok: true } | { ok: false; error: string }> {
  const lot = await getCompiledLot(lotId);
  if (!lot) return { ok: false, error: "No encontrado." };
  if (lot.status !== "DRAFT") return { ok: false, error: "Este corte ya se envió a Inventario." };
  if (lot.batches.length === 0 || (lot.lines.length === 0 && lot.warranty.length === 0 && lot.provisional.length === 0)) return { ok: false, error: "El corte está vacío — sube las guías primero." };

  const updated = await prisma.fulfillmentLot.updateMany({ where: { id: lotId, status: "DRAFT" }, data: { status: "SENT", sentAt: new Date(), sentById: userId } });
  if (updated.count === 0) return { ok: false, error: "Este corte ya se envió a Inventario." };
  const mf = await assignManifestNumber(lotId);

  const units = lot.lines.reduce((s, l) => s + l.quantity, 0);
  const label = `${mf.ok ? `${manifestCode(mf.manifestNumber)} · ` : ""}Corte ${lot.corte} del ${lot.day.split("-").reverse().join("/")}`;
  const danielId = await getInventoryLeadId();
  // Pedido del usuario 2026-09-25: Daniel se entera DESDE EL AVISO de lo que
  // no alcanza según INVESTOCK — y si hay devoluciones que ya llegaron pero
  // no están ingresadas, para que las ingrese antes de sacar la mercadería.
  if (danielId) {
    const shortText =
      lot.shortages.length > 0
        ? ` ⚠️ ${lot.shortages.length} producto(s) no alcanzan en INVESTOCK: ${lot.shortages
            .slice(0, 4)
            .map((s) => {
              const pend = s.pendingReturns.reduce((a, p) => a + p.qty, 0);
              return `${s.name} (piden ${s.needed}, hay ${s.stock}${pend > 0 ? `; ${pend} en devoluciones sin ingresar: ${s.pendingReturns.map((p) => p.label).join(", ")}` : ""})`;
            })
            .join("; ")}${lot.shortages.length > 4 ? ` y ${lot.shortages.length - 4} más` : ""}.`
        : "";
    await notifyOwner(danielId, {
      title: "Nuevo corte de Fulfillment",
      body: `${label}: ${lot.lines.length} productos, ${units} unidades${lot.warranty.length ? `, ${lot.warranty.length} garantía(s)` : ""}. Asigna los bloques a tu equipo desde el corte (imprimir la hoja es opcional).${shortText}`,
      url: LOT_URL,
    });
  }
  // A Bryan Ríos y Jariel solo lo que falta DE VERDAD (descontando las
  // devoluciones que ya están en bodega esperando ingreso) — así no compran
  // algo que ya llegó.
  const realShort = lot.shortages.filter((s) => s.realShortage > 0);
  if (realShort.length > 0) {
    const list = realShort
      .slice(0, 6)
      .map((s) => `${s.name} (faltan ${s.realShortage}: piden ${s.needed}, hay ${s.stock})`)
      .join("; ");
    const more = realShort.length > 6 ? ` y ${realShort.length - 6} más` : "";
    for (const id of await purchaseDeciderIds()) {
      // Pedido de Jariel 2026-09-29: el aviso abría el corte de Fulfillment
      // (pestaña que Compras no tiene) — ahora abre Qué comprar.
      await notifyOwner(id, { title: "Stock insuficiente para despachar", body: `${label}: ${list}${more}.`, url: "/area/workspace?tab=compras&ptab=que-comprar" });
    }
  }
  return { ok: true };
}

// ---- Imprimir el manifiesto (parte 2) -----------------------------------

export function manifestCode(n: number): string {
  return `MF-${String(n).padStart(4, "0")}`;
}

// Número de Manifiesto DAFLOW (MF-0001, MF-0002…), que nunca cambia. Desde
// el 2026-09-26 (pedido de Daniel: se saca la mercadería desde el celular y
// la hoja impresa es opcional) se asigna al ENVIAR el corte a Inventario, no
// al imprimir — así todo corte tiene su MF aunque nunca se imprima. Solo
// cortes ya enviados por Yair — uno en preparación todavía puede cambiar.
export async function assignManifestNumber(lotId: string): Promise<{ ok: true; manifestNumber: number } | { ok: false; error: string }> {
  const lot = await prisma.fulfillmentLot.findUnique({ where: { id: lotId }, select: { status: true, manifestNumber: true } });
  if (!lot) return { ok: false, error: "No encontrado." };
  if (lot.status === "DRAFT") return { ok: false, error: "Este corte todavía no se envía a Inventario." };
  if (lot.manifestNumber) return { ok: true, manifestNumber: lot.manifestNumber };
  for (let attempt = 0; attempt < 3; attempt++) {
    const last = await prisma.fulfillmentLot.aggregate({ _max: { manifestNumber: true } });
    const next = (last._max.manifestNumber ?? 0) + 1;
    try {
      const updated = await prisma.fulfillmentLot.updateMany({ where: { id: lotId, manifestNumber: null }, data: { manifestNumber: next } });
      if (updated.count === 0) {
        const again = await prisma.fulfillmentLot.findUnique({ where: { id: lotId }, select: { manifestNumber: true } });
        if (again?.manifestNumber) return { ok: true, manifestNumber: again.manifestNumber };
      } else {
        return { ok: true, manifestNumber: next };
      }
    } catch {
      // Otro corte tomó ese número al mismo tiempo — se reintenta con el siguiente.
    }
  }
  return { ok: false, error: "No se pudo asignar el número de manifiesto — vuelve a intentar." };
}

// Imprimir (opcional): se asegura el MF y deja registrado quién imprimió la
// primera vez; reimprimir no cambia nada.
export async function markLotPrinted(lotId: string, userId: string | null): Promise<{ ok: true; manifestNumber: number } | { ok: false; error: string }> {
  const res = await assignManifestNumber(lotId);
  if (!res.ok) return res;
  await prisma.fulfillmentLot.updateMany({ where: { id: lotId, printedAt: null }, data: { printedAt: new Date(), printedById: userId } });
  return res;
}

// ---- Corregir la receta de un combo desde el corte ----------------------

export type ComboRecipe = { id: string; code: string; label: string | null; components: (ItemView & { quantity: number })[] };

export async function getComboRecipes(codes: string[]): Promise<ComboRecipe[]> {
  if (codes.length === 0) return [];
  const combos = await prisma.dropiCombo.findMany({
    where: { code: { in: codes } },
    select: { id: true, code: true, label: true, components: { select: { quantity: true, catalogItem: { select: { id: true, name: true, photos: true, justCode: true } } } } },
  });
  return combos.map((c) => ({
    id: c.id,
    code: c.code,
    label: c.label,
    components: c.components.map((k) => ({ catalogItemId: k.catalogItem.id, name: k.catalogItem.name, photos: k.catalogItem.photos, justCode: k.catalogItem.justCode, quantity: k.quantity })),
  }));
}

const recipeText = (parts: { name: string; justCode: string | null; quantity: number }[]) =>
  parts.map((p) => `${p.quantity}× ${p.name}${p.justCode ? ` (${p.justCode})` : ""}`).join(" + ");

// Pedido del usuario 2026-09-25 (caso real: Yair armó el combo 157246
// "Ventilador Humidif y Almohada Ergonómica" con la ALMOHADA SELLADA AL
// VACÍO y le sumó 1 de más al corte): Yair puede corregir él mismo una
// receta que se usa en su corte en preparación, viendo cómo estaba. La
// receta es la misma que usa el despacho real, así que a Daniel le llega
// un aviso con el antes y el después. Los cortes que siguen "En
// preparación" se recalculan con la receta nueva; los ya enviados a
// Inventario no se tocan.
export async function correctComboRecipeFromLot(params: {
  lotId: string;
  code: string;
  components: { catalogItemId: string; quantity: number }[];
  actorName: string;
}): Promise<{ ok: true; warning?: string } | { ok: false; error: string }> {
  const lot = await prisma.fulfillmentLot.findUnique({ where: { id: params.lotId }, select: { status: true } });
  if (!lot) return { ok: false, error: "No encontrado." };
  if (lot.status !== "DRAFT") return { ok: false, error: "Este corte ya se envió a Inventario — pídele a Daniel que corrija la receta." };
  const used = await prisma.fulfillmentRequestItem.count({ where: { fromComboCode: params.code, batch: { lotId: params.lotId } } });
  if (used === 0) return { ok: false, error: "Ese combo no está en este corte." };
  const ids = params.components.map((c) => c.catalogItemId);
  if (new Set(ids).size !== ids.length) return { ok: false, error: "Pusiste el mismo producto dos veces — junta la cantidad en una sola fila." };
  const missing = await componentsMissingDropiId(ids);
  if (missing.length > 0) return { ok: false, error: missingDropiIdMessage(missing) };

  const [before] = await getComboRecipes([params.code]);
  if (!before) return { ok: false, error: "No se encontró la receta de ese combo." };
  const oldPerUnit = new Map(before.components.map((c) => [c.catalogItemId, c.quantity]));
  const newItems = await prisma.purchaseCatalogItem.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, justCode: true } });
  const itemById = new Map(newItems.map((i) => [i.id, i]));
  const afterText = recipeText(params.components.map((c) => ({ name: itemById.get(c.catalogItemId)?.name ?? "—", justCode: itemById.get(c.catalogItemId)?.justCode ?? null, quantity: c.quantity })));
  const beforeText = recipeText(before.components);
  if (beforeText === afterText) return { ok: false, error: "La receta quedó igual que antes — no hay nada que corregir." };

  let skippedWarranty = 0;
  await prisma.$transaction(async (tx) => {
    await tx.dropiComboComponent.deleteMany({ where: { comboId: before.id } });
    await tx.dropiComboComponent.createMany({ data: params.components.map((c) => ({ comboId: before.id, catalogItemId: c.catalogItemId, quantity: c.quantity })) });

    const items = await tx.fulfillmentRequestItem.findMany({
      where: { fromComboCode: params.code, batch: { lot: { status: "DRAFT" } } },
      select: { id: true, batchId: true, catalogItemId: true, quantity: true, sourceCode: true, carrier: true, warrantyGuide: true, warrantyMode: true, warrantyPiece: true },
    });
    // Cuántos pedidos del combo hay en cada grupo (subida + código +
    // transportadora [+ guía de garantía]): se saca de cualquier producto de
    // la receta vieja. Garantías de "solo parte" o "pieza" no se tocan — ahí
    // Yair eligió productos puntuales de la receta vieja.
    const groups = new Map<string, typeof items>();
    for (const it of items) {
      if (it.warrantyGuide && it.warrantyMode !== "COMPLETE") {
        skippedWarranty++;
        continue;
      }
      const key = [it.batchId, it.sourceCode, it.carrier ?? "", it.warrantyGuide ?? ""].join("|");
      groups.set(key, [...(groups.get(key) ?? []), it]);
    }
    const touchedBatches = new Set<string>();
    for (const group of groups.values()) {
      const ref = group.find((g) => oldPerUnit.has(g.catalogItemId));
      if (!ref) continue;
      const orders = Math.round(ref.quantity / oldPerUnit.get(ref.catalogItemId)!);
      const first = group[0];
      await tx.fulfillmentRequestItem.deleteMany({ where: { id: { in: group.map((g) => g.id) } } });
      await tx.fulfillmentRequestItem.createMany({
        data: params.components.map((c) => ({
          batchId: first.batchId,
          catalogItemId: c.catalogItemId,
          quantity: orders * c.quantity,
          sourceCode: first.sourceCode,
          fromComboCode: params.code,
          carrier: first.carrier,
          warrantyGuide: first.warrantyGuide,
          warrantyMode: first.warrantyMode,
          warrantyPiece: first.warrantyPiece,
        })),
      });
      if (!first.warrantyGuide) touchedBatches.add(first.batchId);
    }

    // Variantes: las notas "Combo X: …" eran por producto de la receta vieja
    // — se pasan a pedidos y se rearman con la nueva; luego se recalcula el
    // relleno "Sin variante" de cada producto para que la suma cuadre.
    const prefix = `Combo ${params.code}: `;
    const affected = [...new Set([...before.components.map((c) => c.catalogItemId), ...ids])];
    for (const batchId of touchedBatches) {
      const notes = await tx.fulfillmentRequestVariantNote.findMany({ where: { batchId, label: { startsWith: prefix } } });
      // Pedidos por variante Y transportadora (desde 2026-09-29 cada nota
      // guarda la suya; las viejas quedan con null).
      const perLabel = new Map<string, { label: string; carrier: string | null; orders: number }>();
      for (const n of notes) {
        const per = oldPerUnit.get(n.catalogItemId);
        const key = `${n.label}\u0000${n.carrier ?? ""}`;
        if (per && !perLabel.has(key)) perLabel.set(key, { label: n.label, carrier: n.carrier, orders: Math.round(n.quantity / per) });
      }
      await tx.fulfillmentRequestVariantNote.deleteMany({ where: { id: { in: notes.map((n) => n.id) } } });
      if (perLabel.size > 0) {
        await tx.fulfillmentRequestVariantNote.createMany({
          data: params.components.flatMap((c) => [...perLabel.values()].map(({ label, carrier, orders }) => ({ batchId, catalogItemId: c.catalogItemId, carrier, label, quantity: orders * c.quantity }))),
        });
      }
      for (const catalogItemId of affected) {
        const [items, allNotes] = await Promise.all([
          tx.fulfillmentRequestItem.findMany({ where: { batchId, catalogItemId, warrantyGuide: null }, select: { carrier: true, quantity: true } }),
          tx.fulfillmentRequestVariantNote.findMany({ where: { batchId, catalogItemId } }),
        ]);
        const filler = allNotes.filter((n) => n.label === "Sin variante");
        const real = allNotes.filter((n) => n.label !== "Sin variante");
        await tx.fulfillmentRequestVariantNote.deleteMany({ where: { id: { in: filler.map((f) => f.id) } } });
        if (real.length === 0) continue;
        // Notas con transportadora: relleno por transportadora. Notas viejas
        // (sin transportadora): un solo relleno como antes.
        const withCarrier = real.some((n) => n.carrier);
        const totals = new Map<string | null, number>();
        for (const it of items) {
          const k = withCarrier ? it.carrier : null;
          totals.set(k, (totals.get(k) ?? 0) + it.quantity);
        }
        for (const [carrier, total] of totals) {
          const noted = real.filter((n) => !withCarrier || n.carrier === carrier).reduce((a, n) => a + n.quantity, 0);
          const gap = total - noted;
          if (gap > 0) await tx.fulfillmentRequestVariantNote.create({ data: { batchId, catalogItemId, carrier, label: "Sin variante", quantity: gap } });
        }
      }
    }
  });

  const danielId = await getInventoryLeadId();
  if (danielId) {
    await notifyOwner(danielId, {
      title: `${params.actorName} corrigió la receta de un combo`,
      body: `Combo ${params.code}${before.label ? ` (${before.label})` : ""}. Antes: ${beforeText}. Ahora: ${afterText}.`,
      url: LOT_URL,
    }).catch(() => null);
  }
  return {
    ok: true,
    warning: skippedWarranty > 0 ? `${skippedWarranty} garantía(s) de este combo marcadas como "solo parte" o "pieza" no se cambiaron — revísalas.` : undefined,
  };
}

// ---- Volver a leer variantes de un corte ------------------------------------

// Pedido del usuario 2026-10-03 (corte con la Funda 193889: 13 unidades de
// Gintracom quedaron "Sin variante" porque el lector no entendía "Mujer M").
// Cuando se mejora el lector, Daniel puede releer los PDF guardados del corte
// para recuperar las variantes que antes no se leyeron. Muy conservador:
// - solo cambia transportadoras de un producto que hoy dicen SOLO "Sin
//   variante"/"Sin leer en guías" (nunca toca variantes ya leídas o
//   corregidas), y solo si la nueva lectura trae variantes de verdad;
// - la nueva lectura tiene que cuadrar EXACTO con las cantidades del corte
//   (si no, ese producto se deja como está);
// - nunca cambia cantidades, solo las notas de variante.
const FILLER_LABELS = new Set(["Sin variante", "Sin leer en guías"]);

export type RereadVariantsResult = { ok: true; updated: { name: string; carrier: string | null; labels: string[] }[] } | { ok: false; error: string };

export async function rereadLotVariants(lotId: string, userId: string | null): Promise<RereadVariantsResult> {
  const lot = await prisma.fulfillmentLot.findUnique({
    where: { id: lotId },
    select: {
      batches: {
        select: {
          id: true,
          source: true,
          fileUrls: true,
          items: { select: { catalogItemId: true, quantity: true, sourceCode: true, fromComboCode: true, carrier: true, warrantyGuide: true, catalogItem: { select: { name: true } } } },
          variantNotes: { select: { id: true, catalogItemId: true, carrier: true, label: true } },
        },
      },
    },
  });
  if (!lot) return { ok: false, error: "Corte no encontrado." };

  const updated: { name: string; carrier: string | null; labels: string[] }[] = [];
  for (const batch of lot.batches) {
    if (batch.source !== "DROPI" || batch.fileUrls.length === 0) continue;
    const warrantyGuides = new Set(batch.items.map((i) => i.warrantyGuide).filter((g): g is string => !!g));
    const lines = new Map<string, ParsedGuidesLine>();
    for (const url of batch.fileUrls) {
      const res = await fetch(url).catch(() => null);
      if (!res?.ok) return { ok: false, error: "No se pudo abrir uno de los PDF guardados del corte." };
      const parsed = await parseGuidesPdf(new Uint8Array(await res.arrayBuffer())).catch(() => null);
      if (!parsed || parsed.source !== "DROPI") continue;
      // PDF de garantías (se subió marcado aparte): sus productos no son
      // pedidos normales, no sirve para las variantes.
      if (parsed.guides.length > 0 && parsed.guides.every((g) => warrantyGuides.has(g.number))) continue;
      for (const l of parsed.lines) {
        const prev = lines.get(l.code);
        if (prev) addGuidesLine(prev, l);
        else lines.set(l.code, { ...l, byCarrier: { ...l.byCarrier }, labelUnitsByCarrier: l.labelUnitsByCarrier ? { ...l.labelUnitsByCarrier } : undefined, variants: l.variants.map((v) => ({ ...v, byCarrier: v.byCarrier ? { ...v.byCarrier } : undefined })) });
      }
    }

    // Nuevas notas por producto → transportadora → variante.
    const normal = batch.items.filter((i) => !i.warrantyGuide);
    const fresh = new Map<string, Map<string, Map<string, number>>>();
    const broken = new Set<string>();
    for (const it of normal) {
      const line = lines.get(it.sourceCode);
      const carrier = it.carrier ?? NO_CARRIER;
      const rowQty = line?.byCarrier[carrier] ?? 0;
      const breakdown = line ? rowBreakdownByCarrier({ ...line, decision: { kind: "ignore" } } as GuidesApplyRow)?.get(carrier) : undefined;
      if (!line || !rowQty || it.quantity % rowQty !== 0 || !breakdown || breakdown.length === 0) {
        broken.add(it.catalogItemId);
        continue;
      }
      const perUnit = it.quantity / rowQty;
      let byCarrier = fresh.get(it.catalogItemId);
      if (!byCarrier) fresh.set(it.catalogItemId, (byCarrier = new Map()));
      let m = byCarrier.get(carrier);
      if (!m) byCarrier.set(carrier, (m = new Map()));
      for (const b of breakdown) {
        const label = it.fromComboCode ? `Combo ${it.fromComboCode}: ${b.label}` : b.label;
        m.set(label, (m.get(label) ?? 0) + b.quantity * perUnit);
      }
    }

    const toDelete: string[] = [];
    const toCreate: { batchId: string; catalogItemId: string; carrier: string | null; label: string; quantity: number; createdById: string | null }[] = [];
    for (const [catalogItemId, byCarrier] of fresh) {
      if (broken.has(catalogItemId)) continue;
      for (const [carrier, m] of byCarrier) {
        const dbCarrier = carrier === NO_CARRIER ? null : carrier;
        const total = normal.filter((i) => i.catalogItemId === catalogItemId && (i.carrier ?? NO_CARRIER) === carrier).reduce((a, i) => a + i.quantity, 0);
        const sum = [...m.values()].reduce((a, b) => a + b, 0);
        const hasReal = [...m.keys()].some((l) => !FILLER_LABELS.has(l.replace(/^Combo \S+: /, "")));
        const existing = batch.variantNotes.filter((n) => n.catalogItemId === catalogItemId && n.carrier === dbCarrier);
        const onlyFiller = existing.every((n) => FILLER_LABELS.has(n.label.replace(/^Combo \S+: /, "")));
        if (sum !== total || !hasReal || !onlyFiller) continue;
        toDelete.push(...existing.map((n) => n.id));
        for (const [label, quantity] of m) toCreate.push({ batchId: batch.id, catalogItemId, carrier: dbCarrier, label, quantity, createdById: userId });
        updated.push({ name: normal.find((i) => i.catalogItemId === catalogItemId)!.catalogItem.name, carrier: dbCarrier, labels: [...m].map(([l, q]) => `${l} ${q}`) });
      }
    }
    if (toCreate.length === 0) continue;
    await prisma.$transaction([
      prisma.fulfillmentRequestVariantNote.deleteMany({ where: { id: { in: toDelete } } }),
      prisma.fulfillmentRequestVariantNote.createMany({ data: toCreate }),
    ]);
  }
  return { ok: true, updated };
}
