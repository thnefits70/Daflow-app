import { prisma } from "@/lib/prisma";

export type JustCatalogParsedRow = { code: string; name: string };

// Marca de "son productos distintos" para un grupo duplicado — compartida
// entre la clasificación, el guardado de la decisión y el frontend
// (JustCatalogPanel) para que las tres partes usen el mismo valor.
export const DUPLICATE_DISTINCT = "__distinct__";

// Exportadas (2026-08-31) para que Sugerencias de Combos ATOM+baja rotación
// (src/lib/atomSync.ts) reutilice el mismo criterio de coincidencia sin IA,
// en vez de reimplementarlo — ver justificación de costo más abajo.
export function normalize(s: string): string {
  return s.trim().replace(/\s+/g, " ").toUpperCase();
}

// Palabras de relleno sin valor para reconocer un producto — se ignoran al
// comparar nombres por palabras en común (ver findSimilarUnlinkedItem).
const STOPWORDS = new Set(["DE", "DEL", "LA", "EL", "LOS", "LAS", "UN", "UNA", "UNOS", "UNAS", "Y", "O", "CON", "PARA", "POR", "EN", "A", "AL", "TIPO"]);

export function significantWords(name: string): Set<string> {
  return new Set(normalize(name).split(/\s+/).filter((w) => w.length >= 2 && !STOPWORDS.has(w)));
}

// Confirmado 2026-08-21 (pedido explícito del usuario tras revisar el primer
// resultado): la coincidencia EXACTA sola dejaba fuera casos reales como
// Just "PISTOLA DE AGUA TIPO MOCHILA" vs DAFLOW "Pistola de agua" — mismo
// producto, nombre más corto/distinto. En vez de IA (costo real por fila,
// mismo motivo que ya sacó el reconocimiento por IA de Reingreso), se
// compara por palabras significativas en común: si al menos el 60% de las
// palabras del nombre más corto (mínimo 2 coincidencias) están en el otro
// nombre, se sugiere como posible vínculo — nunca se auto-vincula, Daniel
// siempre confirma o rechaza fila por fila en la vista previa.
export function findSimilarUnlinkedItem(
  rowWords: Set<string>,
  candidates: { id: string; name: string; words: Set<string> }[]
): { id: string; name: string } | null {
  let best: { id: string; name: string; score: number } | null = null;
  for (const c of candidates) {
    const smaller = Math.min(rowWords.size, c.words.size);
    if (smaller < 2) continue;
    let intersection = 0;
    for (const w of rowWords) if (c.words.has(w)) intersection++;
    const needed = Math.max(2, Math.ceil(smaller * 0.6));
    if (intersection < needed) continue;
    const score = intersection / smaller;
    if (!best || score > best.score) best = { id: c.id, name: c.name, score };
  }
  return best ? { id: best.id, name: best.name } : null;
}

export type NameChangedPreviewRow = { code: string; itemId: string; currentName: string; justName: string };
export type SuggestedLinkPreviewRow = { code: string; name: string; itemId: string; existingName: string; matchType: "exact" | "similar" };
export type DuplicateGroupRow = { code: string; name: string; alreadyLinked: boolean; existingName: string | null };
export type DuplicateGroupPreviewRow = { groupName: string; rows: DuplicateGroupRow[] };
export type MissingItemRow = { id: string; name: string; justCode: string; hasPhotos: boolean };

export type JustCatalogPreview = {
  totalRows: number;
  unchangedCount: number;
  newRows: JustCatalogParsedRow[];
  nameChangedRows: NameChangedPreviewRow[];
  suggestedLinkRows: SuggestedLinkPreviewRow[];
  duplicateGroups: DuplicateGroupPreviewRow[];
  missingItems: MissingItemRow[];
  // Confirmado 2026-09-01: grupos duplicados que NO se muestran para
  // decisión porque Daniel ya resolvió exactamente este mismo grupo (mismo
  // nombre + mismos códigos) en una subida anterior — ver
  // JustCatalogDuplicateResolution. Solo informativo en la vista previa.
  autoResolvedDuplicateGroups: number;
};

// Clave estable para recordar la decisión de un grupo duplicado: nombre
// normalizado + códigos ordenados. Si aparece un código nuevo bajo el mismo
// nombre en una subida futura, la clave cambia y sí se vuelve a preguntar.
function duplicateGroupKey(groupName: string, codes: string[]): string {
  return `${normalize(groupName)}::${[...codes].sort().join(",")}`;
}

// Clasifica cada fila del export de Just contra el catálogo ya existente —
// confirmado 2026-08-21 (varias rondas de preguntas antes de tocar código):
// - justCode ya vinculado y el nombre coincide -> "unchanged", no hace falta
//   ninguna decisión.
// - justCode ya vinculado pero el nombre cambió en Just -> "nameChanged",
//   Daniel decide fila por fila si actualiza el nombre en DAFLOW o lo deja
//   como está (nunca se auto-decide, para no romper fotos/historial de un
//   producto por un cambio de nombre en Just).
// - código nuevo y el nombre coincide, exacto o por palabras significativas
//   en común (ver findSimilarUnlinkedItem), con un producto existente sin
//   justCode -> "suggestedLink" (matchType "exact"/"similar"), Daniel
//   confirma el vínculo o lo trata como un producto aparte. Sin IA — mismo
//   criterio de costo que ya sacó el reconocimiento por IA de Reingreso (ver
//   catalog-search/route.ts) — pero desde 2026-08-21 ya no es SOLO
//   coincidencia exacta: el usuario pidió explícitamente que se detecten
//   nombres parecidos (ej. "PISTOLA DE AGUA TIPO MOCHILA" en Just vs
//   "Pistola de agua" ya matriculado en DAFLOW), porque la coincidencia
//   exacta sola dejaba fuera casi todos los productos ya matriculados con un
//   nombre distinto al de Just. Nunca se auto-vincula ninguno de los dos
//   tipos — solo cambia el valor por defecto en la UI (ver JustCatalogPanel).
// - código nuevo, nombre sin coincidencia -> "new", se crea automático como
//   esqueleto (sin fotos, pendingRegistration=true) — no necesita decisión
//   fila por fila, solo aparece contado/listado en la vista previa.
// - mismo nombre repetido 2+ veces DENTRO del propio archivo de Just con
//   códigos distintos -> "duplicateGroup" (confirmado 2026-08-24, pedido
//   explícito del usuario tras ver que antes esto se creaba solo con un
//   "(código)" pegado al nombre sin que nadie lo revisara — riesgo real de
//   que Bryan/Reingreso terminen vinculando el mismo producto físico a dos
//   entradas distintas de DAFLOW). Estas filas quedan totalmente FUERA de
//   la clasificación normal de arriba hasta que Daniel decide por grupo:
//   "mantener un solo código" (los demás códigos del grupo no se crean —
//   Daniel debe ir a corregir/eliminar el duplicado en Just para que no
//   vuelva a aparecer) o "son productos distintos" (se crean todos). Sin
//   decisión, el grupo no crea nada — vuelve a aparecer en la próxima
//   subida hasta que se resuelva, ese reintento constante ES el
//   seguimiento: no hay forma de que un duplicado quede enterrado en
//   silencio.
// - producto que YA tenía justCode vinculado pero su código no aparece en
//   ESTE archivo -> "missingItems" (confirmado 2026-08-24, pedido del
//   usuario). No se borra ni se desvincula nada automático — solo se lista
//   para que Daniel revise si Just lo descontinuó o le cambió el código.
export async function classifyJustCatalogRows(rows: JustCatalogParsedRow[]): Promise<JustCatalogPreview> {
  const existingItems = await prisma.purchaseCatalogItem.findMany({
    select: { id: true, name: true, justCode: true, pendingRegistration: true, photos: true },
  });
  const byJustCode = new Map(existingItems.filter((i) => i.justCode).map((i) => [i.justCode as string, i]));
  const unlinkedItems = existingItems.filter((i) => !i.justCode);
  const byNormalizedName = new Map(unlinkedItems.map((i) => [normalize(i.name), i]));
  const unlinkedWithWords = unlinkedItems.map((i) => ({ id: i.id, name: i.name, words: significantWords(i.name) }));
  const linkedThisImport = new Set<string>(); // evita sugerir el mismo item existente a dos filas distintas del archivo

  const nameGroups = new Map<string, JustCatalogParsedRow[]>();
  for (const row of rows) {
    const key = normalize(row.name);
    nameGroups.set(key, [...(nameGroups.get(key) ?? []), row]);
  }
  const duplicateGroupEntries = [...nameGroups.values()].filter((groupRows) => groupRows.length > 1);

  // Confirmado 2026-09-01: antes de pedirle a Daniel que decida un grupo
  // duplicado, se revisa si ya decidió exactamente este mismo grupo (mismo
  // nombre + mismos códigos) en una subida anterior — si sí, se aplica esa
  // decisión sola, sin volver a preguntar.
  const candidateKeys = duplicateGroupEntries.map((groupRows) => duplicateGroupKey(groupRows[0].name, groupRows.map((r) => r.code)));
  const savedResolutions =
    candidateKeys.length > 0
      ? await prisma.justCatalogDuplicateResolution.findMany({ where: { groupKey: { in: candidateKeys } } })
      : [];
  const resolutionByKey = new Map(savedResolutions.map((r) => [r.groupKey, r]));

  // Códigos que Daniel ya decidió NO crear nunca (el resto de un grupo
  // donde eligió "mantener" un código distinto) — se descartan por completo,
  // no pasan por ninguna clasificación.
  const permanentlySkippedCodes = new Set<string>();
  let autoResolvedDuplicateGroups = 0;
  const dupedCodes = new Set<string>();
  const duplicateGroups: DuplicateGroupPreviewRow[] = [];

  duplicateGroupEntries.forEach((groupRows, gi) => {
    const key = candidateKeys[gi];
    const resolution = resolutionByKey.get(key);
    if (!resolution) {
      groupRows.forEach((r) => dupedCodes.add(r.code));
      duplicateGroups.push({
        groupName: groupRows[0].name,
        rows: groupRows.map((r) => {
          const linked = byJustCode.get(r.code);
          return { code: r.code, name: r.name, alreadyLinked: !!linked, existingName: linked?.name ?? null };
        }),
      });
      return;
    }
    autoResolvedDuplicateGroups++;
    if (resolution.decision !== DUPLICATE_DISTINCT) {
      const keptCode = resolution.decision;
      groupRows.forEach((r) => {
        if (r.code !== keptCode) permanentlySkippedCodes.add(r.code);
      });
    }
    // Si la decisión guardada fue "son productos distintos", no se hace
    // nada más — cada código sigue su clasificación normal más abajo.
  });

  const newRows: JustCatalogParsedRow[] = [];
  const nameChangedRows: NameChangedPreviewRow[] = [];
  const suggestedLinkRows: SuggestedLinkPreviewRow[] = [];
  let unchangedCount = 0;

  for (const row of rows) {
    if (dupedCodes.has(row.code) || permanentlySkippedCodes.has(row.code)) continue;
    const linked = byJustCode.get(row.code);
    if (linked) {
      if (normalize(linked.name) === normalize(row.name)) {
        unchangedCount++;
      } else {
        nameChangedRows.push({ code: row.code, itemId: linked.id, currentName: linked.name, justName: row.name });
      }
      continue;
    }
    const exact = byNormalizedName.get(normalize(row.name));
    if (exact && !linkedThisImport.has(exact.id)) {
      linkedThisImport.add(exact.id);
      suggestedLinkRows.push({ code: row.code, name: row.name, itemId: exact.id, existingName: exact.name, matchType: "exact" });
      continue;
    }
    const similar = findSimilarUnlinkedItem(
      significantWords(row.name),
      unlinkedWithWords.filter((c) => !linkedThisImport.has(c.id))
    );
    if (similar) {
      linkedThisImport.add(similar.id);
      suggestedLinkRows.push({ code: row.code, name: row.name, itemId: similar.id, existingName: similar.name, matchType: "similar" });
      continue;
    }
    newRows.push(row);
  }

  const uploadedCodes = new Set(rows.map((r) => r.code));
  const missingItems: MissingItemRow[] = existingItems
    .filter((i) => i.justCode && !uploadedCodes.has(i.justCode))
    .map((i) => ({ id: i.id, name: i.name, justCode: i.justCode as string, hasPhotos: i.photos.length > 0 }));

  return {
    totalRows: rows.length,
    unchangedCount,
    newRows,
    nameChangedRows,
    suggestedLinkRows,
    duplicateGroups,
    missingItems,
    autoResolvedDuplicateGroups,
  };
}

export type JustCatalogApplyDecisions = {
  newRows: JustCatalogParsedRow[];
  nameChangedDecisions: { itemId: string; code: string; justName: string; useJustName: boolean }[];
  suggestedLinkDecisions: { itemId: string; code: string; name: string; link: boolean }[];
  // Códigos que Daniel confirmó crear a partir de un grupo duplicado
  // (uno solo si eligió "mantener este código", todos los no vinculados
  // si confirmó "son productos distintos") — ver classifyJustCatalogRows.
  duplicateGroupDecisions: { code: string; name: string }[];
  // Confirmado 2026-09-01: una entrada por cada grupo duplicado que Daniel
  // resolvió activamente en esta subida (no los que ya venían auto-resueltos
  // de una decisión previa) — se guardan para que la próxima subida no
  // vuelva a preguntar el mismo grupo (ver classifyJustCatalogRows).
  duplicateGroupResolutions: { groupName: string; codes: string[]; decision: string }[];
  duplicateGroupsTotal: number;
  duplicateGroupsResolved: number;
  missingCount: number;
};

export async function applyJustCatalogImport(decisions: JustCatalogApplyDecisions, totalRows: number, importedById: string | null) {
  let createdCount = 0;
  let linkedCount = 0;
  let renamedCount = 0;
  // Confirmado 2026-09-01: justCode de cada producto creado en esta subida —
  // sirve para, después de la transacción, ubicar sus IDs reales y disparar
  // la sugerencia automática de nicho (ver suggestNichoIfMissing) sin tener
  // que volver a la creación fila por fila dentro de la transacción.
  const createdJustCodes: string[] = [];

  // `PurchaseCatalogItem.name` es @unique — el export real de Just trae
  // algunos nombres repetidos con código distinto (mismo nombre, dos SKU
  // reales). En vez de que la fila que llega segunda reviente la creación,
  // se le agrega el código entre paréntesis para que ambas queden
  // registradas — Daniel puede renombrarla después si hace falta.
  //
  // La verificación de nombres se hace UNA sola vez con un findMany antes de
  // la transacción (antes era un findUnique por cada fila nueva — con los
  // ~400 productos nuevos típicos de un export de Just eso eran cientos de
  // consultas secuenciales dentro de la transacción, superaba el timeout de
  // 5s de Prisma y la transacción entera se revertía sin guardar nada,
  // aunque Daniel hubiera confirmado todas las decisiones). Igual, las
  // creaciones masivas (newRows, duplicateGroupDecisions) se agrupan en un
  // solo createMany en vez de una fila a la vez.
  const existingNames = new Set((await prisma.purchaseCatalogItem.findMany({ select: { name: true } })).map((i) => normalize(i.name)));
  const taken = new Set<string>();
  function resolveUniqueName(desiredName: string, code: string): string {
    const norm = normalize(desiredName);
    if (!existingNames.has(norm) && !taken.has(norm)) {
      taken.add(norm);
      return desiredName;
    }
    const candidate = `${desiredName} (${code})`;
    taken.add(normalize(candidate));
    return candidate;
  }

  const newItemsData = decisions.newRows.map((row) => ({
    name: resolveUniqueName(row.name, row.code),
    justCode: row.code,
    photos: [] as string[],
    pendingRegistration: true,
  }));
  const duplicateItemsData = decisions.duplicateGroupDecisions.map((d) => ({
    name: resolveUniqueName(d.name, d.code),
    justCode: d.code,
    photos: [] as string[],
    pendingRegistration: true,
  }));
  createdJustCodes.push(...newItemsData.map((d) => d.justCode), ...duplicateItemsData.map((d) => d.justCode));

  await prisma.$transaction(
    async (tx) => {
      if (newItemsData.length > 0) await tx.purchaseCatalogItem.createMany({ data: newItemsData });
      createdCount += newItemsData.length;

      for (const d of decisions.suggestedLinkDecisions) {
        if (d.link) {
          await tx.purchaseCatalogItem.update({ where: { id: d.itemId }, data: { justCode: d.code } });
          linkedCount++;
        } else {
          const name = resolveUniqueName(d.name, d.code);
          await tx.purchaseCatalogItem.create({ data: { name, justCode: d.code, photos: [], pendingRegistration: true } });
          createdCount++;
          createdJustCodes.push(d.code);
        }
      }

      for (const d of decisions.nameChangedDecisions) {
        if (d.useJustName) {
          const name = resolveUniqueName(d.justName, d.code);
          await tx.purchaseCatalogItem.update({ where: { id: d.itemId }, data: { name } });
          renamedCount++;
        }
      }

      if (duplicateItemsData.length > 0) await tx.purchaseCatalogItem.createMany({ data: duplicateItemsData });
      createdCount += duplicateItemsData.length;
    },
    { timeout: 30000 }
  );

  if (decisions.duplicateGroupResolutions.length > 0) {
    await Promise.all(
      decisions.duplicateGroupResolutions.map((r) => {
        const groupKey = duplicateGroupKey(r.groupName, r.codes);
        return prisma.justCatalogDuplicateResolution.upsert({
          where: { groupKey },
          create: { groupKey, groupName: r.groupName, codes: r.codes, decision: r.decision, decidedById: importedById },
          update: { decision: r.decision, decidedById: importedById, decidedAt: new Date() },
        });
      })
    );
  }

  await prisma.justCatalogImport.create({
    data: {
      importedById,
      totalRows,
      createdCount,
      linkedCount,
      renamedCount,
      duplicateGroupsTotal: decisions.duplicateGroupsTotal,
      duplicateGroupsResolved: decisions.duplicateGroupsResolved,
      missingCount: decisions.missingCount,
    },
  });

  // Confirmado 2026-09-01: IDs de todo lo creado en esta subida, para que la
  // ruta que llama a esto dispare la sugerencia automática de nicho (fuera
  // de esta transacción, vía after() — nunca bloquea ni forma parte del
  // guardado real).
  const newlyCreatedIds =
    createdJustCodes.length > 0
      ? (await prisma.purchaseCatalogItem.findMany({ where: { justCode: { in: createdJustCodes } }, select: { id: true } })).map((i) => i.id)
      : [];

  return { createdCount, linkedCount, renamedCount, newlyCreatedIds };
}
