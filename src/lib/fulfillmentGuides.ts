import { prisma } from "@/lib/prisma";
import { normalizeName, type ParsedGuidesLine } from "@/lib/dropiGuidesPdf";
import { findSimilarUnlinkedItem, significantWords } from "@/lib/justCatalog";

// Confirmado 2026-09-23, pedido de Yair aprobado por el usuario (opción A:
// esto sigue siendo SOLO la lista de lo que Fulfillment necesita — no
// descuenta stock; el descuento real en INVESTOCK lo sigue haciendo Daniel
// al registrar el despacho). Regla del usuario: para INVESTOCK solo existe
// el ID de Dropi (justCode del catálogo); un combo siempre se abre en sus
// productos reales, y cada uno de esos productos tiene que tener su propio
// ID de Dropi.

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

export type GuidesApplyRow = {
  code: string;
  name: string;
  quantity: number;
  labelUnits: number;
  variants: { label: string; quantity: number }[];
  decision: { kind: "product"; catalogItemId: string } | { kind: "combo" } | { kind: "ignore" };
};

export type GuidesApplyInput = {
  fileUrls: string[];
  manifestDate: string | null;
  guides: { number: string; carrier: string }[];
  rows: GuidesApplyRow[];
};

export type GuidesApplyResult = { ok: true; batchId: string } | { ok: false; error: string };

export async function findAlreadyUploadedGuides(numbers: string[]): Promise<{ number: string; requestedAt: Date }[]> {
  if (numbers.length === 0) return [];
  const found = await prisma.fulfillmentRequestGuide.findMany({
    where: { guideNumber: { in: numbers } },
    select: { guideNumber: true, batch: { select: { requestedAt: true } } },
  });
  return found.map((f) => ({ number: f.guideNumber, requestedAt: f.batch.requestedAt }));
}

// Desglose de variantes de UNA fila del PDF: lo que se leyó en las
// etiquetas + lo que quedó sin variante + lo que no se alcanzó a leer. Suma
// siempre exactamente `quantity` (así cuadra con la validación de
// saveVariantNotes). Vacío si la fila no trae ninguna variante.
function rowBreakdown(row: GuidesApplyRow): { label: string; quantity: number }[] {
  const variants = row.variants.filter((v) => v.label.trim() && v.quantity > 0);
  if (variants.length === 0) return [];
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

export async function applyGuidesImport(input: GuidesApplyInput, userId: string | null): Promise<GuidesApplyResult> {
  const dup = await findAlreadyUploadedGuides(input.guides.map((g) => g.number));
  if (dup.length > 0) {
    return { ok: false, error: `${dup.length} guía(s) de este PDF ya se subieron antes (ej. ${dup[0].number}) — no se vuelven a sumar. Revisa el historial del día.` };
  }

  const productRows = input.rows.filter((r) => r.decision.kind === "product");
  const comboRows = input.rows.filter((r) => r.decision.kind === "combo");
  const ignoreRows = input.rows.filter((r) => r.decision.kind === "ignore");

  const pickedIds = [...new Set(productRows.map((r) => (r.decision as { catalogItemId: string }).catalogItemId))];
  const [pickedItems, combos, codeOwners] = await Promise.all([
    prisma.purchaseCatalogItem.findMany({ where: { id: { in: pickedIds } }, select: { id: true, name: true, justCode: true } }),
    prisma.dropiCombo.findMany({
      where: { code: { in: comboRows.map((r) => r.code) } },
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

  type ItemRow = { catalogItemId: string; quantity: number; sourceCode: string; fromComboCode: string | null; breakdown: { label: string; quantity: number }[] };
  const itemRows: ItemRow[] = [];

  for (const row of productRows) {
    const itemId = (row.decision as { catalogItemId: string }).catalogItemId;
    const item = itemById.get(itemId);
    if (!item) return { ok: false, error: `No se encontró el producto elegido para el código ${row.code}.` };
    if (item.justCode !== row.code) {
      const owner = ownerByCode.get(row.code);
      if (owner && owner.id !== item.id) return { ok: false, error: `El código ${row.code} ya pertenece a "${owner.name}" — elige ese producto.` };
      if (!item.justCode) {
        // El producto no tenía ID de Dropi: se le pone este — es lo que la
        // app "aprende" para no volver a preguntar.
        assignCode.push({ itemId: item.id, code: row.code });
      } else {
        // El producto ya tiene OTRO ID de Dropi (ej. mismo producto
        // publicado dos veces en Dropi): se guarda como equivalencia 1:1 —
        // un combo de un solo producto — nunca se pisa el ID existente.
        aliasCombos.push({ code: row.code, label: row.name, itemId: item.id });
      }
    }
    itemRows.push({ catalogItemId: item.id, quantity: row.quantity, sourceCode: row.code, fromComboCode: null, breakdown: rowBreakdown(row) });
  }

  if (new Set(assignCode.map((a) => a.itemId)).size !== assignCode.length) {
    return { ok: false, error: "Elegiste el mismo producto para dos códigos distintos de Dropi — revisa las filas." };
  }

  for (const row of comboRows) {
    const combo = comboByCode.get(row.code);
    if (!combo || combo.components.length === 0) return { ok: false, error: `El combo ${row.code} todavía no tiene receta registrada.` };
    const missing = combo.components.filter((c) => !c.catalogItem.justCode?.trim()).map((c) => c.catalogItem.name);
    if (missing.length > 0) return { ok: false, error: `Combo ${row.code}: ${missingDropiIdMessage(missing)}` };
    const breakdown = rowBreakdown(row);
    for (const comp of combo.components) {
      itemRows.push({
        catalogItemId: comp.catalogItemId,
        quantity: comp.quantity * row.quantity,
        sourceCode: row.code,
        fromComboCode: combo.code,
        breakdown: breakdown.map((b) => ({ label: `Combo ${combo.code}: ${b.label}`, quantity: b.quantity * comp.quantity })),
      });
    }
  }

  if (itemRows.length === 0) return { ok: false, error: "No hay ningún producto listo para guardar." };

  // Notas de variante por producto: solo si alguna de sus filas trae
  // variantes; las demás filas del mismo producto entran como "Sin
  // variante" para que la suma cuadre con el total.
  const notesByItem = new Map<string, Map<string, number>>();
  const itemsWithVariants = new Set(itemRows.filter((r) => r.breakdown.length > 0).map((r) => r.catalogItemId));
  for (const r of itemRows) {
    if (!itemsWithVariants.has(r.catalogItemId)) continue;
    let m = notesByItem.get(r.catalogItemId);
    if (!m) notesByItem.set(r.catalogItemId, (m = new Map()));
    const parts = r.breakdown.length > 0 ? r.breakdown : [{ label: "Sin variante", quantity: r.quantity }];
    for (const p of parts) m.set(p.label, (m.get(p.label) ?? 0) + p.quantity);
  }

  try {
    const batch = await prisma.$transaction(async (tx) => {
      for (const a of assignCode) {
        await tx.purchaseCatalogItem.update({ where: { id: a.itemId }, data: { justCode: a.code } });
      }
      for (const a of aliasCombos) {
        await tx.dropiCombo.create({
          data: { code: a.code, label: `${a.label} (equivalente)`, createdById: userId, components: { create: [{ catalogItemId: a.itemId, quantity: 1 }] } },
        });
      }
      for (const r of ignoreRows) {
        await tx.dropiIgnoredCode.upsert({ where: { code: r.code }, create: { code: r.code, label: r.name, createdById: userId }, update: { label: r.name } });
      }
      return tx.fulfillmentRequestBatch.create({
        data: {
          source: "DROPI",
          requestedById: userId,
          totalRows: input.rows.length,
          skippedCount: ignoreRows.length,
          fileUrls: input.fileUrls,
          manifestDate: input.manifestDate,
          items: { create: itemRows.map((r) => ({ catalogItemId: r.catalogItemId, quantity: r.quantity, sourceCode: r.sourceCode, fromComboCode: r.fromComboCode })) },
          guides: { create: input.guides.map((g) => ({ guideNumber: g.number, carrier: g.carrier })) },
          variantNotes: {
            create: [...notesByItem.entries()].flatMap(([catalogItemId, m]) =>
              [...m.entries()].map(([label, quantity]) => ({ catalogItemId, label, quantity, createdById: userId }))
            ),
          },
        },
      });
    });
    return { ok: true, batchId: batch.id };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg.includes("Unique constraint")) {
      return { ok: false, error: "Otra persona acaba de subir alguna de estas guías o de registrar uno de estos códigos — vuelve a leer el PDF." };
    }
    throw e;
  }
}

// ---- Lote del día --------------------------------------------------------

// Ecuador no tiene horario de verano: siempre UTC-5.
const EC_OFFSET_MS = 5 * 60 * 60 * 1000;

export function ecuadorDay(d: Date): string {
  return new Date(d.getTime() - EC_OFFSET_MS).toISOString().slice(0, 10);
}

export type DayLine = {
  catalogItemId: string;
  name: string;
  photos: string[];
  justCode: string | null;
  quantity: number;
  bySource: { DROPI: number; ROCKET: number };
  variants: { label: string; quantity: number }[];
};

export async function getCompiledDay(day: string) {
  const start = new Date(new Date(`${day}T00:00:00.000Z`).getTime() + EC_OFFSET_MS);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  const batches = await prisma.fulfillmentRequestBatch.findMany({
    where: { requestedAt: { gte: start, lt: end } },
    orderBy: { requestedAt: "asc" },
    include: {
      requestedBy: { select: { name: true } },
      items: { include: { catalogItem: { select: { id: true, name: true, photos: true, justCode: true } } } },
      variantNotes: { select: { catalogItemId: true, label: true, quantity: true } },
      _count: { select: { guides: true } },
    },
  });

  const byItem = new Map<string, DayLine & { variantMap: Map<string, number> }>();
  for (const b of batches) {
    const src = b.source === "ROCKET" ? "ROCKET" : "DROPI";
    for (const it of b.items) {
      let line = byItem.get(it.catalogItemId);
      if (!line) {
        line = { catalogItemId: it.catalogItemId, name: it.catalogItem.name, photos: it.catalogItem.photos, justCode: it.catalogItem.justCode, quantity: 0, bySource: { DROPI: 0, ROCKET: 0 }, variants: [], variantMap: new Map() };
        byItem.set(it.catalogItemId, line);
      }
      line.quantity += it.quantity;
      line.bySource[src] += it.quantity;
    }
    for (const v of b.variantNotes) {
      const line = byItem.get(v.catalogItemId);
      if (line) line.variantMap.set(v.label, (line.variantMap.get(v.label) ?? 0) + v.quantity);
    }
  }

  // Un lote con variantes para un producto + otro lote sin ellas: lo del
  // otro lote entra como "Sin variante", para que la suma cuadre.
  const lines: DayLine[] = [...byItem.values()].map(({ variantMap, ...l }) => {
    if (variantMap.size === 0) return l;
    const noted = [...variantMap.values()].reduce((a, b) => a + b, 0);
    const variants = [...variantMap.entries()].map(([label, quantity]) => ({ label, quantity }));
    if (noted < l.quantity) variants.push({ label: "Sin variante", quantity: l.quantity - noted });
    return { ...l, variants: variants.sort((a, b) => b.quantity - a.quantity) };
  });

  return {
    day,
    batches: batches.map((b) => ({
      id: b.id,
      source: b.source,
      requestedAt: b.requestedAt,
      requestedByName: b.requestedBy?.name ?? "Administrador",
      guideCount: b._count.guides,
      fileCount: b.fileUrls.length,
    })),
    lines: lines.sort((a, b) => b.quantity - a.quantity),
  };
}
