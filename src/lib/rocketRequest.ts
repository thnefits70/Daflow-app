import { prisma } from "@/lib/prisma";
import { normalize, significantWords, findSimilarUnlinkedItem } from "@/lib/justCatalog";
import { getOrCreateOpenLot } from "@/lib/fulfillmentGuides";

// Confirmado 2026-09-21 — ver memoria project_investock_fulfillment_request_control
// y el modelo RocketCodeMapping en schema.prisma para el porqué completo.
export type RocketParsedRow = { code: string; name: string; quantity: number };

export type RocketTarget = { type: "product" | "combo"; id: string; name: string; componentsCount: number | null; comboCode: string | null };
export type RocketReadyRow = { code: string; name: string; quantity: number; target: RocketTarget };
export type RocketSuggestedRow = { code: string; name: string; quantity: number; suggestion: RocketTarget; matchType: "exact" | "similar" };
export type RocketUnmatchedRow = { code: string; name: string; quantity: number };
export type RocketCandidate = { type: "product" | "combo"; id: string; name: string; componentsCount: number | null; comboCode: string | null };

export type RocketRequestPreview = {
  totalRows: number;
  readyRows: RocketReadyRow[];
  suggestedRows: RocketSuggestedRow[];
  unmatchedRows: RocketUnmatchedRow[];
  // Todo el universo de productos/combos, para que Yair pueda buscar a mano
  // cuando no hay ninguna sugerencia (mismo criterio que ProductMatchPicker:
  // se trae la lista completa una sola vez, se filtra en el navegador).
  candidates: RocketCandidate[];
};

export async function classifyRocketRows(rows: RocketParsedRow[]): Promise<RocketRequestPreview> {
  const [mappings, catalogItems, combos] = await Promise.all([
    prisma.rocketCodeMapping.findMany({
      select: {
        rocketCode: true,
        catalogItem: { select: { id: true, name: true } },
        dropiCombo: { select: { id: true, code: true, label: true, components: { select: { id: true } } } },
      },
    }),
    prisma.purchaseCatalogItem.findMany({ select: { id: true, name: true } }),
    prisma.dropiCombo.findMany({ select: { id: true, code: true, label: true, components: { select: { id: true } } } }),
  ]);

  const mappingByCode = new Map(mappings.map((m) => [m.rocketCode, m]));

  type Candidate = { id: string; name: string; words: Set<string>; type: "product" | "combo"; componentsCount: number | null; comboCode: string | null };
  const productCandidates: Candidate[] = catalogItems.map((c) => ({ id: c.id, name: c.name, words: significantWords(c.name), type: "product", componentsCount: null, comboCode: null }));
  // Los combos sin `label` (nombre de Dropi) no tienen con qué compararse por
  // nombre — igual quedan disponibles para búsqueda manual (ver `candidates`).
  const comboCandidates: Candidate[] = combos
    .filter((c) => c.label)
    .map((c) => ({ id: c.id, name: c.label as string, words: significantWords(c.label as string), type: "combo", componentsCount: c.components.length, comboCode: c.code }));
  const allCandidates = [...productCandidates, ...comboCandidates];
  const byNormalizedName = new Map(allCandidates.map((c) => [normalize(c.name), c]));

  const readyRows: RocketReadyRow[] = [];
  const suggestedRows: RocketSuggestedRow[] = [];
  const unmatchedRows: RocketUnmatchedRow[] = [];
  const linkedThisImport = new Set<string>();

  for (const row of rows) {
    const mapping = mappingByCode.get(row.code);
    if (mapping && (mapping.catalogItem || mapping.dropiCombo)) {
      const target: RocketTarget = mapping.catalogItem
        ? { type: "product", id: mapping.catalogItem.id, name: mapping.catalogItem.name, componentsCount: null, comboCode: null }
        : {
            type: "combo",
            id: mapping.dropiCombo!.id,
            name: mapping.dropiCombo!.label ?? mapping.dropiCombo!.code,
            componentsCount: mapping.dropiCombo!.components.length,
            comboCode: mapping.dropiCombo!.code,
          };
      readyRows.push({ code: row.code, name: row.name, quantity: row.quantity, target });
      continue;
    }

    const exact = byNormalizedName.get(normalize(row.name));
    if (exact && !linkedThisImport.has(`${exact.type}:${exact.id}`)) {
      linkedThisImport.add(`${exact.type}:${exact.id}`);
      suggestedRows.push({
        code: row.code,
        name: row.name,
        quantity: row.quantity,
        matchType: "exact",
        suggestion: { type: exact.type, id: exact.id, name: exact.name, componentsCount: exact.componentsCount, comboCode: exact.comboCode },
      });
      continue;
    }

    const similar = findSimilarUnlinkedItem(
      significantWords(row.name),
      allCandidates.filter((c) => !linkedThisImport.has(`${c.type}:${c.id}`))
    );
    if (similar) {
      linkedThisImport.add(`${similar.id}`); // el id solo alcanza para evitar re-sugerir el mismo dos veces en este archivo
      const full = allCandidates.find((c) => c.id === similar.id && c.name === similar.name)!;
      suggestedRows.push({
        code: row.code,
        name: row.name,
        quantity: row.quantity,
        matchType: "similar",
        suggestion: { type: full.type, id: full.id, name: full.name, componentsCount: full.componentsCount, comboCode: full.comboCode },
      });
      continue;
    }

    unmatchedRows.push({ code: row.code, name: row.name, quantity: row.quantity });
  }

  return {
    totalRows: rows.length,
    readyRows,
    suggestedRows,
    unmatchedRows,
    candidates: allCandidates.map((c) => ({ type: c.type, id: c.id, name: c.name, componentsCount: c.componentsCount, comboCode: c.comboCode })),
  };
}

export type RocketApplyRow = {
  code: string;
  name: string;
  quantity: number;
  targetType: "product" | "combo";
  targetId: string;
  // true cuando este código Rocket todavía no tenía RocketCodeMapping — se
  // guarda para no volver a preguntar en la próxima subida.
  createMapping: boolean;
};

export type RocketApplyDecisions = {
  totalRows: number;
  rows: RocketApplyRow[];
  skippedCount: number;
};

export type RocketApplyResult =
  | { ok: true; batchId: string; itemsCreated: number; mappingsCreated: number }
  | { ok: false; error: string };

export async function applyRocketImport(decisions: RocketApplyDecisions, requestedById: string | null): Promise<RocketApplyResult> {
  const comboIds = [...new Set(decisions.rows.filter((r) => r.targetType === "combo").map((r) => r.targetId))];
  const combos =
    comboIds.length > 0
      ? await prisma.dropiCombo.findMany({ where: { id: { in: comboIds } }, select: { id: true, code: true, label: true, components: { select: { catalogItemId: true, quantity: true } } } })
      : [];
  const comboById = new Map(combos.map((c) => [c.id, c]));

  // Nunca se calcula mal en silencio: si Yair (o una subida anterior)
  // apuntó a un combo que todavía no tiene receta registrada, se bloquea
  // toda la aplicación (nada se guarda a medias) hasta que Daniel/admin
  // registre esa receta en "Base de datos de productos".
  const missingRecipe = decisions.rows.filter((r) => r.targetType === "combo" && (comboById.get(r.targetId)?.components.length ?? 0) === 0);
  if (missingRecipe.length > 0) {
    const names = [...new Set(missingRecipe.map((r) => comboById.get(r.targetId)?.label ?? comboById.get(r.targetId)?.code ?? r.targetId))];
    return { ok: false, error: `Estos combos no tienen receta registrada todavía, así que no se puede calcular la cantidad real: ${names.join(", ")}. Pide que registren la receta en "Base de datos de productos" antes de subir este archivo.` };
  }

  const itemsData: { catalogItemId: string; quantity: number; sourceCode: string; fromComboCode: string | null }[] = [];
  for (const row of decisions.rows) {
    if (row.targetType === "product") {
      itemsData.push({ catalogItemId: row.targetId, quantity: row.quantity, sourceCode: row.code, fromComboCode: null });
      continue;
    }
    const combo = comboById.get(row.targetId)!;
    for (const comp of combo.components) {
      itemsData.push({ catalogItemId: comp.catalogItemId, quantity: comp.quantity * row.quantity, sourceCode: row.code, fromComboCode: combo.code });
    }
  }

  const newMappings = decisions.rows.filter((r) => r.createMapping);
  // Entra al corte abierto de hoy, igual que Dropi. Sin transportadora por
  // ahora (el Excel de Rocket no la trae — pendiente de confirmar con Yair).
  const lot = await getOrCreateOpenLot();

  const batch = await prisma.$transaction(async (tx) => {
    const created = await tx.fulfillmentRequestBatch.create({
      data: {
        source: "ROCKET",
        requestedById,
        lotId: lot.id,
        totalRows: decisions.totalRows,
        skippedCount: decisions.skippedCount,
        items: { create: itemsData },
      },
    });
    for (const m of newMappings) {
      await tx.rocketCodeMapping.upsert({
        where: { rocketCode: m.code },
        create: {
          rocketCode: m.code,
          rocketName: m.name,
          catalogItemId: m.targetType === "product" ? m.targetId : null,
          dropiComboId: m.targetType === "combo" ? m.targetId : null,
          createdById: requestedById,
        },
        update: {
          rocketName: m.name,
          catalogItemId: m.targetType === "product" ? m.targetId : null,
          dropiComboId: m.targetType === "combo" ? m.targetId : null,
        },
      });
    }
    return created;
  });

  return { ok: true, batchId: batch.id, itemsCreated: itemsData.length, mappingsCreated: newMappings.length };
}

export type VariantNote = { label: string; quantity: number };
export type CompiledFulfillmentLine = { catalogItemId: string; name: string; photos: string[]; justCode: string | null; quantity: number; variants: VariantNote[] };

export async function getCompiledBatch(batchId: string): Promise<{ id: string; source: string; requestedAt: Date; requestedByName: string; totalRows: number; skippedCount: number; lines: CompiledFulfillmentLine[] } | null> {
  const batch = await prisma.fulfillmentRequestBatch.findUnique({
    where: { id: batchId },
    include: {
      requestedBy: { select: { name: true } },
      items: { include: { catalogItem: { select: { id: true, name: true, photos: true, justCode: true } } } },
      variantNotes: { select: { catalogItemId: true, label: true, quantity: true } },
    },
  });
  if (!batch) return null;

  const byItem = new Map<string, CompiledFulfillmentLine>();
  for (const item of batch.items) {
    const existing = byItem.get(item.catalogItemId);
    if (existing) existing.quantity += item.quantity;
    else byItem.set(item.catalogItemId, { catalogItemId: item.catalogItemId, name: item.catalogItem.name, photos: item.catalogItem.photos, justCode: item.catalogItem.justCode, quantity: item.quantity, variants: [] });
  }
  for (const v of batch.variantNotes) {
    byItem.get(v.catalogItemId)?.variants.push({ label: v.label, quantity: v.quantity });
  }

  return {
    id: batch.id,
    source: batch.source,
    requestedAt: batch.requestedAt,
    requestedByName: batch.requestedBy?.name ?? "Administrador",
    totalRows: batch.totalRows,
    skippedCount: batch.skippedCount,
    lines: [...byItem.values()].sort((a, b) => b.quantity - a.quantity),
  };
}

export type SaveVariantsResult = { ok: true; variants: VariantNote[] } | { ok: false; error: string };

// Confirmado 2026-09-21: la versión digital de lo que Yair anotaba a mano en
// el papel — reemplaza TODO el desglose de ese producto en ese batch (no
// incremental), y se valida que la suma cuadre con el total real antes de
// guardar nada, a diferencia del papel donde nadie revisaba la suma.
export async function saveVariantNotes(batchId: string, catalogItemId: string, variants: VariantNote[], createdById: string | null): Promise<SaveVariantsResult> {
  const lot = await prisma.fulfillmentRequestBatch.findUnique({ where: { id: batchId }, select: { lot: { select: { status: true } } } });
  if (lot?.lot && lot.lot.status !== "DRAFT") return { ok: false, error: "Este corte ya se envió a Inventario — ya no se puede cambiar." };
  // Las garantías se marcan aparte (ver fulfillmentGuides) — no cuentan en el desglose de variantes.
  const items = await prisma.fulfillmentRequestItem.findMany({ where: { batchId, catalogItemId, warrantyGuide: null }, select: { quantity: true } });
  if (items.length === 0) return { ok: false, error: "Ese producto no está en este compendiado." };
  const total = items.reduce((sum, i) => sum + i.quantity, 0);

  const cleaned = variants.map((v) => ({ label: v.label.trim(), quantity: Math.round(v.quantity) })).filter((v) => v.label && v.quantity > 0);
  const sum = cleaned.reduce((s, v) => s + v.quantity, 0);
  if (cleaned.length > 0 && sum !== total) {
    return { ok: false, error: `Las variantes suman ${sum}, pero este producto necesita ${total} en total — ajusta las cantidades antes de guardar.` };
  }

  await prisma.$transaction([
    prisma.fulfillmentRequestVariantNote.deleteMany({ where: { batchId, catalogItemId } }),
    ...(cleaned.length > 0
      ? [prisma.fulfillmentRequestVariantNote.createMany({ data: cleaned.map((v) => ({ batchId, catalogItemId, label: v.label, quantity: v.quantity, createdById })) })]
      : []),
  ]);

  return { ok: true, variants: cleaned };
}
