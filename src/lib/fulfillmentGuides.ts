import { prisma } from "@/lib/prisma";
import { normalizeName, type ParsedGuidesLine } from "@/lib/dropiGuidesPdf";
import { findSimilarUnlinkedItem, significantWords } from "@/lib/justCatalog";
import { getCurrentStockByItemIds } from "@/lib/stockKardex";
import { notifyOwner } from "@/lib/notifications";
import { getInventoryLeadId } from "@/lib/guards";
import { NO_CARRIER, sortCarriers } from "@/lib/carriers";

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

export async function resolveGuideLines(lines: ParsedGuidesLine[]): Promise<ResolvedGuideLine[]> {
  const codes = lines.map((l) => l.code);
  const [items, combos, ignored, allItems] = await Promise.all([
    prisma.purchaseCatalogItem.findMany({ where: { justCode: { in: codes } }, select: ITEM_SELECT }),
    prisma.dropiCombo.findMany({
      where: { code: { in: codes } },
      select: { code: true, label: true, components: { select: { quantity: true, catalogItem: { select: ITEM_SELECT } } } },
    }),
    prisma.dropiIgnoredCode.findMany({ where: { code: { in: codes } }, select: { code: true, label: true } }),
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
    const item = itemByCode.get(l.code);
    if (item) return { ...l, resolution: { kind: "product", catalogItem: item } };
    const combo = comboByCode.get(l.code);
    if (combo) {
      if (combo.components.length === 0) return { ...l, resolution: { kind: "comboNoRecipe", comboCode: combo.code } };
      return {
        ...l,
        resolution: {
          kind: "combo",
          comboCode: combo.code,
          label: combo.label,
          components: combo.components.map((c) => ({ catalogItem: c.catalogItem, quantity: c.quantity })),
          missingIds: combo.components.filter((c) => !c.catalogItem.justCode?.trim()).map((c) => c.catalogItem.name),
        },
      };
    }
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

type Decision = { kind: "product"; catalogItemId: string } | { kind: "combo" } | { kind: "ignore" };

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
  const productRows = input.rows.filter((r) => r.decision.kind === "product");
  const comboCodes = input.rows.filter((r) => r.decision.kind === "combo").map((r) => r.code);
  const ignoreRows = input.rows.filter((r) => r.decision.kind === "ignore");

  const pickedIds = [...new Set(productRows.map((r) => (r.decision as { catalogItemId: string }).catalogItemId))];
  const [pickedItems, combos, codeOwners] = await Promise.all([
    prisma.purchaseCatalogItem.findMany({ where: { id: { in: pickedIds } }, select: { id: true, name: true, justCode: true } }),
    prisma.dropiCombo.findMany({
      where: { code: { in: comboCodes } },
      select: { code: true, components: { select: { catalogItemId: true, quantity: true, catalogItem: { select: { name: true, justCode: true } } } } },
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
    return comboByCode.get(code)!.components.map((c) => ({ catalogItemId: c.catalogItemId, perUnit: c.quantity, fromCombo: code }));
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
      for (const r of ignoreRows) {
        await tx.dropiIgnoredCode.upsert({ where: { code: r.code }, create: { code: r.code, label: r.name, createdById: userId }, update: { label: r.name } });
      }
      return tx.fulfillmentRequestBatch.create({
        data: {
          source: "DROPI",
          requestedById: userId,
          lotId: lot.id,
          totalRows: input.rows.length,
          skippedCount: ignoreRows.length,
          fileUrls: input.fileUrls,
          manifestDate: input.manifestDate,
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
  variants: { label: string; quantity: number }[];
};
export type LotWarrantyLine = ItemView & { guide: string; carrier: string; quantity: number; mode: string; piece: string | null; fromComboCode: string | null };
export type LotShortage = ItemView & { needed: number; stock: number };

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
          _count: { select: { guides: true } },
        },
      },
    },
  });
  if (!lot) return null;
  const sentBy = lot.sentById ? await prisma.user.findUnique({ where: { id: lot.sentById }, select: { name: true } }) : null;

  const lines = new Map<string, LotLine & { variantMap: Map<string, number> }>();
  const warranty: LotWarrantyLine[] = [];
  const carriers = new Set<string>();
  for (const b of lot.batches) {
    for (const it of b.items) {
      const view: ItemView = { catalogItemId: it.catalogItemId, name: it.catalogItem.name, photos: it.catalogItem.photos, justCode: it.catalogItem.justCode };
      if (it.warrantyGuide) {
        warranty.push({ ...view, guide: it.warrantyGuide, carrier: it.carrier ?? NO_CARRIER, quantity: it.quantity, mode: it.warrantyMode ?? "COMPLETE", piece: it.warrantyPiece, fromComboCode: it.fromComboCode });
        // (piece = pieza en modo PIECE; en los demás, el color/talla de la guía)
        continue;
      }
      const carrier = it.carrier ?? NO_CARRIER;
      carriers.add(carrier);
      let line = lines.get(it.catalogItemId);
      if (!line) lines.set(it.catalogItemId, (line = { ...view, quantity: 0, byCarrier: {}, variants: [], variantMap: new Map() }));
      line.quantity += it.quantity;
      line.byCarrier[carrier] = (line.byCarrier[carrier] ?? 0) + it.quantity;
    }
    for (const v of b.variantNotes) {
      const line = lines.get(v.catalogItemId);
      if (line) line.variantMap.set(v.label, (line.variantMap.get(v.label) ?? 0) + v.quantity);
    }
  }

  const lineList: LotLine[] = [...lines.values()].map(({ variantMap, ...l }) => {
    const variants = [...variantMap.entries()].filter(([label]) => label !== "Sin variante" || variantMap.size > 1).map(([label, quantity]) => ({ label, quantity }));
    return { ...l, variants: variants.sort((a, b) => b.quantity - a.quantity) };
  });

  // Aviso temprano de stock: lo pedido (normal + garantías que no son
  // pieza) contra el saldo actual de INVESTOCK.
  const needed = new Map<string, { view: ItemView; qty: number }>();
  for (const l of lineList) needed.set(l.catalogItemId, { view: l, qty: l.quantity });
  for (const w of warranty) {
    if (w.mode === "PIECE") continue;
    const cur = needed.get(w.catalogItemId);
    if (cur) cur.qty += w.quantity;
    else needed.set(w.catalogItemId, { view: w, qty: w.quantity });
  }
  const stock = await getCurrentStockByItemIds([...needed.keys()]);
  const shortages: LotShortage[] = [...needed.values()]
    .map(({ view, qty }) => ({ catalogItemId: view.catalogItemId, name: view.name, photos: view.photos, justCode: view.justCode, needed: qty, stock: stock.get(view.catalogItemId)?.balance ?? 0 }))
    .filter((s) => s.stock < s.needed)
    .sort((a, b) => b.needed - b.stock - (a.needed - a.stock));

  return {
    id: lot.id,
    day: lot.day,
    corte: lot.corte,
    status: lot.status,
    sentAt: lot.sentAt,
    sentByName: sentBy?.name ?? (lot.sentById ? "—" : null),
    carriers: sortCarriers([...carriers]),
    batches: lot.batches.map((b) => ({
      id: b.id,
      source: b.source,
      requestedAt: b.requestedAt,
      requestedByName: b.requestedBy?.name ?? "Administrador",
      guideCount: b._count.guides,
      fileCount: b.fileUrls.length,
    })),
    lines: lineList.sort((a, b) => b.quantity - a.quantity),
    warranty,
    shortages,
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
async function purchaseDeciderIds(): Promise<string[]> {
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
  if (danielId) {
    await notifyOwner(danielId, {
      title: "Nuevo corte de Fulfillment",
      body: `${label}: ${lot.lines.length} productos, ${units} unidades${lot.warranty.length ? `, ${lot.warranty.length} garantía(s)` : ""}. Revisa e imprime el manifiesto.`,
      url: LOT_URL,
    });
  }
  if (lot.shortages.length > 0) {
    const list = lot.shortages
      .slice(0, 6)
      .map((s) => `${s.name} (piden ${s.needed}, hay ${s.stock})`)
      .join("; ");
    const more = lot.shortages.length > 6 ? ` y ${lot.shortages.length - 6} más` : "";
    for (const id of await purchaseDeciderIds()) {
      await notifyOwner(id, { title: "Stock insuficiente para despachar", body: `${label}: ${list}${more}.`, url: LOT_URL });
    }
  }
  return { ok: true };
}
