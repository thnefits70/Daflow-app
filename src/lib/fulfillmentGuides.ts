import { prisma } from "@/lib/prisma";
import { isRocketCode, normalizeName, ROCKET_PREFIX, type ParsedGuidesLine } from "@/lib/dropiGuidesPdf";
import { findSimilarUnlinkedItem, significantWords } from "@/lib/justCatalog";
import { getCurrentStockByItemIds } from "@/lib/stockKardex";
import { notifyOwner } from "@/lib/notifications";
import { getInventoryLeadId } from "@/lib/guards";
import { lineBlock, NO_CARRIER, sortCarriers } from "@/lib/carriers";

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

export async function resolveGuideLines(lines: ParsedGuidesLine[]): Promise<ResolvedGuideLine[]> {
  // Los códigos de Rocket ("R14599") no son IDs de Dropi: se reconocen por
  // lo que Yair ya vinculó antes (RocketCodeMapping), nunca por justCode.
  const codes = lines.map((l) => l.code).filter((c) => !isRocketCode(c));
  const rocketCodes = lines.map((l) => l.code).filter(isRocketCode).map((c) => c.slice(ROCKET_PREFIX.length));
  const rocketMappings = await prisma.rocketCodeMapping.findMany({
    where: { rocketCode: { in: rocketCodes } },
    select: { rocketCode: true, catalogItem: { select: ITEM_SELECT }, dropiCombo: { select: COMBO_SELECT } },
  });
  const rocketByCode = new Map(rocketMappings.map((m) => [`${ROCKET_PREFIX}${m.rocketCode}`, m]));
  const [items, combos, ignored, allItems] = await Promise.all([
    prisma.purchaseCatalogItem.findMany({ where: { justCode: { in: codes } }, select: ITEM_SELECT }),
    prisma.dropiCombo.findMany({ where: { code: { in: codes } }, select: COMBO_SELECT }),
    prisma.dropiIgnoredCode.findMany({ where: { code: { in: lines.map((l) => l.code) } }, select: { code: true, label: true } }),
    // Candidatos para sugerir cuando el código es nuevo. Confirmado con
    // datos reales 2026-09-23: Dropi tiene VARIOS IDs para el mismo
    // producto físico (ej. Pistola de Soldar 118388 y 112139, Licuadora
    // Potente 123676 y 125399), así que se busca en todo el catálogo — los
    // que aún no tienen ID primero (caso pistola hidrolavadora).
    prisma.purchaseCatalogItem.findMany({ select: ITEM_SELECT, orderBy: { justCode: { sort: "asc", nulls: "first" } } }),
  ]);
  const itemByCode = new Map(items.map((i) => [i.justCode!, i]));
  const comboByCode = new Map(combos.map((c) => [c.code, c]));
  const ignoredByCode = new Map(ignored.map((i) => [i.code, i.label]));
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

// ---- Guardar la lectura del PDF -----------------------------------------

// comboCode: el combo de Dropi que corresponde. Para un código de Dropi es
// el mismo código; para uno de Rocket, el combo de Dropi al que Yair lo vinculó.
type Decision = { kind: "product"; catalogItemId: string } | { kind: "combo"; comboCode?: string } | { kind: "ignore" };

export type GuidesApplyRow = {
  code: string;
  name: string;
  quantity: number;
  byCarrier: Record<string, number>;
  labelUnits: number;
  variants: { label: string; quantity: number }[];
  decision: Decision;
};

export type WarrantyDecision =
  | { mode: "COMPLETE" }
  // Solo algunos productos del combo — ids de los que SÍ salen.
  | { mode: "PARTIAL"; catalogItemIds: string[] }
  // Solo una pieza: de qué producto es y qué pieza (sale del stock de
  // repuestos aparte, nunca del Kardex del producto).
  | { mode: "PIECE"; catalogItemId: string; piece: string };

export type GuidesApplyWarranty = { guide: string; carrier: string; code: string; quantity: number; variant: string | null; decision: WarrantyDecision };

export type GuidesApplyInput = {
  fileUrls: string[];
  // Lo que no se pudo leer bien (se le mostró a Yair) — queda guardado.
  parseWarnings?: string[];
  manifestDate: string | null;
  guides: { number: string; carrier: string }[];
  rows: GuidesApplyRow[];
  warranty: GuidesApplyWarranty[];
};

export type GuidesApplyResult = { ok: true; batchId: string; lotId: string } | { ok: false; error: string };

// Desglose de variantes de UNA fila del PDF: lo que se leyó en las
// etiquetas + lo que quedó sin variante + lo que no se alcanzó a leer. Suma
// siempre exactamente `quantity` (así cuadra con la validación de
// saveVariantNotes). Vacío si la fila no trae ninguna variante.
function rowBreakdown(row: GuidesApplyRow): { label: string; quantity: number }[] {
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
  breakdown: { label: string; quantity: number }[];
};

export async function applyGuidesImport(input: GuidesApplyInput, userId: string | null): Promise<GuidesApplyResult> {
  const dup = await findAlreadyUploadedGuides(input.guides.map((g) => g.number));
  if (dup.length > 0) {
    return { ok: false, error: `${dup.length} guía(s) de este PDF ya se subieron antes (ej. ${dup[0].number}) — no se vuelven a sumar.` };
  }

  const decisionByCode = new Map(input.rows.map((r) => [r.code, r.decision]));
  const comboCodeOf = (r: GuidesApplyRow) => (r.decision.kind === "combo" ? r.decision.comboCode ?? r.code : null);
  // Rocket: lo que Yair confirma se guarda como vínculo ID de Rocket → producto/combo
  // (RocketCodeMapping) — nunca toca el ID de Dropi del catálogo.
  const rocketRows = input.rows.filter((r) => isRocketCode(r.code) && r.decision.kind !== "ignore");
  const productRows = input.rows.filter((r) => r.decision.kind === "product" && !isRocketCode(r.code));
  const comboCodes = [...new Set(input.rows.map(comboCodeOf).filter((c): c is string => !!c && !isRocketCode(c)))];
  const ignoreRows = input.rows.filter((r) => r.decision.kind === "ignore");

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
  const aliasCombos: { code: string; label: string; itemId: string }[] = [];

  for (const row of productRows) {
    const item = itemById.get((row.decision as { catalogItemId: string }).catalogItemId);
    if (!item) return { ok: false, error: `No se encontró el producto elegido para el código ${row.code}.` };
    if (item.justCode === row.code) continue;
    const owner = ownerByCode.get(row.code);
    if (owner && owner.id !== item.id) return { ok: false, error: `El código ${row.code} ya pertenece a "${owner.name}" — elige ese producto.` };
    if (!item.justCode) {
      // El producto no tenía ID de Dropi: se le pone este — es lo que la
      // app "aprende" para no volver a preguntar.
      assignCode.push({ itemId: item.id, code: row.code });
    } else {
      // Confirmado por el usuario 2026-09-23: Dropi publica el mismo
      // producto con varios IDs ("de promoción"), pero en INVESTOCK existe
      // uno solo — se guarda como ID alterno (combo 1:1), nunca se pisa el
      // ID madre.
      aliasCombos.push({ code: row.code, label: row.name, itemId: item.id });
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
    if (d.kind === "product") return [{ catalogItemId: d.catalogItemId, perUnit: 1, fromCombo: null }];
    const comboCode = d.comboCode ?? code;
    return comboByCode.get(comboCode)!.components.map((c) => ({ catalogItemId: c.catalogItemId, perUnit: c.quantity, fromCombo: comboCode }));
  };

  const itemRows: ItemRow[] = [];
  for (const row of input.rows) {
    const parts = expand(row.code);
    if (!parts || row.quantity === 0) continue;
    const breakdown = rowBreakdown(row);
    for (const part of parts) {
      const carriers = Object.entries(row.byCarrier).filter(([, q]) => q > 0);
      carriers.forEach(([carrier, q], idx) => {
        itemRows.push({
          catalogItemId: part.catalogItemId,
          quantity: q * part.perUnit,
          sourceCode: row.code,
          fromComboCode: part.fromCombo,
          carrier,
          // El desglose de variantes va una sola vez por producto (en la
          // primera transportadora) — es del total, no de cada una.
          breakdown:
            idx === 0
              ? breakdown.map((b) => ({ label: part.fromCombo ? `Combo ${part.fromCombo}: ${b.label}` : b.label, quantity: b.quantity * part.perUnit }))
              : [],
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
        breakdown: [],
      });
    }
  }

  if (itemRows.length === 0) return { ok: false, error: "No hay ningún producto listo para guardar." };

  // Notas de variante por producto: solo si alguna de sus filas trae
  // variantes; las demás filas del mismo producto entran como "Sin
  // variante" para que la suma cuadre con el total.
  // Las garantías no entran: se ven aparte, con lo que Yair marcó.
  const normalRows = itemRows.filter((r) => !r.warrantyGuide);
  const notesByItem = new Map<string, Map<string, number>>();
  const itemsWithVariants = new Set(normalRows.filter((r) => r.breakdown.length > 0).map((r) => r.catalogItemId));
  const totalByItem = new Map<string, number>();
  for (const r of normalRows) totalByItem.set(r.catalogItemId, (totalByItem.get(r.catalogItemId) ?? 0) + r.quantity);
  for (const r of normalRows) {
    if (!itemsWithVariants.has(r.catalogItemId)) continue;
    let m = notesByItem.get(r.catalogItemId);
    if (!m) notesByItem.set(r.catalogItemId, (m = new Map()));
    for (const p of r.breakdown) m.set(p.label, (m.get(p.label) ?? 0) + p.quantity);
  }
  for (const [itemId, m] of notesByItem) {
    const noted = [...m.values()].reduce((a, b) => a + b, 0);
    const total = totalByItem.get(itemId) ?? 0;
    if (noted < total) m.set("Sin variante", (m.get("Sin variante") ?? 0) + total - noted);
  }

  const lot = await getOrCreateOpenLot();

  try {
    const batch = await prisma.$transaction(async (tx) => {
      const fresh = await tx.fulfillmentLot.findUnique({ where: { id: lot.id }, select: { status: true } });
      if (fresh?.status !== "DRAFT") throw new Error("LOT_CLOSED");
      for (const a of assignCode) {
        await tx.purchaseCatalogItem.update({ where: { id: a.itemId }, data: { justCode: a.code } });
      }
      for (const a of aliasCombos) {
        await tx.dropiCombo.create({
          data: { code: a.code, label: `${a.label} (ID alterno)`, createdById: userId, components: { create: [{ catalogItemId: a.itemId, quantity: 1 }] } },
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
          skippedCount: ignoreRows.length,
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
            })),
          },
          guides: { create: input.guides.map((g) => ({ guideNumber: g.number, carrier: g.carrier })) },
          variantNotes: {
            create: [...notesByItem.entries()].flatMap(([catalogItemId, m]) =>
              [...m.entries()].map(([label, quantity]) => ({ catalogItemId, label, quantity, createdById: userId }))
            ),
          },
        },
      });
    });
    return { ok: true, batchId: batch.id, lotId: lot.id };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg === "LOT_CLOSED") return { ok: false, error: "El corte se acaba de enviar a Inventario — vuelve a guardar y entrará al corte siguiente." };
    if (msg.includes("Unique constraint")) {
      return { ok: false, error: "Otra persona acaba de subir alguna de estas guías o de registrar uno de estos códigos — vuelve a leer el PDF." };
    }
    throw e;
  }
}

// ---- Ver un corte --------------------------------------------------------

type ItemView = { catalogItemId: string; name: string; photos: string[]; justCode: string | null };

export type LotLine = ItemView & {
  quantity: number;
  byCarrier: Record<string, number>;
  // 2026-09-25: de qué combos salen estas unidades, para que Yair vea si una
  // receta mal armada le está sumando de más.
  fromCombos: { code: string; quantity: number }[];
  variants: { label: string; quantity: number }[];
};
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
          items: { include: { catalogItem: { select: { id: true, name: true, photos: true, justCode: true } } } },
          variantNotes: { select: { catalogItemId: true, label: true, quantity: true } },
          guides: { select: { carrier: true } },
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

  const lines = new Map<string, LotLine & { variantMap: Map<string, number> }>();
  const warranty: LotWarrantyLine[] = [];
  const carriers = new Set<string>();
  for (const b of lot.batches) {
    for (const it of b.items) {
      const view: ItemView = { catalogItemId: it.catalogItemId, name: it.catalogItem.name, photos: it.catalogItem.photos, justCode: it.catalogItem.justCode };
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
      if (line) line.variantMap.set(v.label, (line.variantMap.get(v.label) ?? 0) + v.quantity);
    }
  }

  // Pedido de Yair (2026-09-26): además de las unidades, cuántas guías
  // (paquetes) salen por transportadora, contadas de las guías que leyó el PDF.
  const guidesByCarrier: Record<string, number> = {};
  for (const b of lot.batches) for (const g of b.guides) guidesByCarrier[g.carrier] = (guidesByCarrier[g.carrier] ?? 0) + 1;

  const lineList: LotLine[] = [...lines.values()].map(({ variantMap, ...l }) => {
    const variants = [...variantMap.entries()].filter(([label]) => label !== "Sin variante" || variantMap.size > 1).map(([label, quantity]) => ({ label, quantity }));
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
    carriers: sortCarriers([...carriers]),
    guidesByCarrier,
    batches: lot.batches.map((b) => ({
      id: b.id,
      source: b.source,
      requestedAt: b.requestedAt,
      requestedByName: b.requestedBy?.name ?? "Administrador",
      guideCount: b.guides.length,
      fileCount: b.fileUrls.length,
    })),
    lines: lineList.sort((a, b) => b.quantity - a.quantity),
    warranty,
    combos,
    shortages,
    picking: picking.sort((a, b) => b.needed - a.needed),
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
  return lots.map((l) => ({
    id: l.id,
    day: l.day,
    corte: l.corte,
    status: l.status,
    createdAt: l.createdAt,
    sentAt: l.sentAt,
    uploads: l.batches.length,
    guides: l.batches.reduce((s, b) => s + b._count.guides, 0),
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
  if (lot.batches.length === 0 || (lot.lines.length === 0 && lot.warranty.length === 0)) return { ok: false, error: "El corte está vacío — sube las guías primero." };

  const updated = await prisma.fulfillmentLot.updateMany({ where: { id: lotId, status: "DRAFT" }, data: { status: "SENT", sentAt: new Date(), sentById: userId } });
  if (updated.count === 0) return { ok: false, error: "Este corte ya se envió a Inventario." };

  const units = lot.lines.reduce((s, l) => s + l.quantity, 0);
  const label = `Corte ${lot.corte} del ${lot.day.split("-").reverse().join("/")}`;
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
      body: `${label}: ${lot.lines.length} productos, ${units} unidades${lot.warranty.length ? `, ${lot.warranty.length} garantía(s)` : ""}. Revisa e imprime el manifiesto.${shortText}`,
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
      await notifyOwner(id, { title: "Stock insuficiente para despachar", body: `${label}: ${list}${more}.`, url: LOT_URL });
    }
  }
  return { ok: true };
}

// ---- Imprimir el manifiesto (parte 2) -----------------------------------

export function manifestCode(n: number): string {
  return `MF-${String(n).padStart(4, "0")}`;
}

// La primera impresión le da al corte su número de Manifiesto DAFLOW
// (MF-0001, MF-0002…); reimprimir usa el mismo número. Solo cortes ya
// enviados por Yair — uno en preparación todavía puede cambiar.
export async function markLotPrinted(lotId: string, userId: string | null): Promise<{ ok: true; manifestNumber: number } | { ok: false; error: string }> {
  const lot = await prisma.fulfillmentLot.findUnique({ where: { id: lotId }, select: { status: true, manifestNumber: true } });
  if (!lot) return { ok: false, error: "No encontrado." };
  if (lot.status === "DRAFT") return { ok: false, error: "Yair todavía no envía este corte a Inventario." };
  if (lot.manifestNumber) return { ok: true, manifestNumber: lot.manifestNumber };
  for (let attempt = 0; attempt < 3; attempt++) {
    const last = await prisma.fulfillmentLot.aggregate({ _max: { manifestNumber: true } });
    const next = (last._max.manifestNumber ?? 0) + 1;
    try {
      const updated = await prisma.fulfillmentLot.updateMany({ where: { id: lotId, manifestNumber: null }, data: { manifestNumber: next, printedAt: new Date(), printedById: userId } });
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
      const perLabel = new Map<string, number>();
      for (const n of notes) {
        const per = oldPerUnit.get(n.catalogItemId);
        if (per && !perLabel.has(n.label)) perLabel.set(n.label, Math.round(n.quantity / per));
      }
      await tx.fulfillmentRequestVariantNote.deleteMany({ where: { id: { in: notes.map((n) => n.id) } } });
      if (perLabel.size > 0) {
        await tx.fulfillmentRequestVariantNote.createMany({
          data: params.components.flatMap((c) => [...perLabel.entries()].map(([label, orders]) => ({ batchId, catalogItemId: c.catalogItemId, label, quantity: orders * c.quantity }))),
        });
      }
      for (const catalogItemId of affected) {
        const [total, allNotes] = await Promise.all([
          tx.fulfillmentRequestItem.aggregate({ where: { batchId, catalogItemId, warrantyGuide: null }, _sum: { quantity: true } }),
          tx.fulfillmentRequestVariantNote.findMany({ where: { batchId, catalogItemId } }),
        ]);
        const filler = allNotes.filter((n) => n.label === "Sin variante");
        const noted = allNotes.filter((n) => n.label !== "Sin variante").reduce((a, n) => a + n.quantity, 0);
        await tx.fulfillmentRequestVariantNote.deleteMany({ where: { id: { in: filler.map((f) => f.id) } } });
        const gap = (total._sum.quantity ?? 0) - noted;
        if (noted > 0 && gap > 0) await tx.fulfillmentRequestVariantNote.create({ data: { batchId, catalogItemId, label: "Sin variante", quantity: gap } });
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
