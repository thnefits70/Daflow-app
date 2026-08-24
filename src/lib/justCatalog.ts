import { prisma } from "@/lib/prisma";

export type JustCatalogParsedRow = { code: string; name: string };

function normalize(s: string): string {
  return s.trim().replace(/\s+/g, " ").toUpperCase();
}

// Palabras de relleno sin valor para reconocer un producto — se ignoran al
// comparar nombres por palabras en común (ver findSimilarUnlinkedItem).
const STOPWORDS = new Set(["DE", "DEL", "LA", "EL", "LOS", "LAS", "UN", "UNA", "UNOS", "UNAS", "Y", "O", "CON", "PARA", "POR", "EN", "A", "AL", "TIPO"]);

function significantWords(name: string): Set<string> {
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
function findSimilarUnlinkedItem(
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
};

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
  const dupedCodes = new Set(duplicateGroupEntries.flatMap((groupRows) => groupRows.map((r) => r.code)));
  const duplicateGroups: DuplicateGroupPreviewRow[] = duplicateGroupEntries.map((groupRows) => ({
    groupName: groupRows[0].name,
    rows: groupRows.map((r) => {
      const linked = byJustCode.get(r.code);
      return { code: r.code, name: r.name, alreadyLinked: !!linked, existingName: linked?.name ?? null };
    }),
  }));

  const newRows: JustCatalogParsedRow[] = [];
  const nameChangedRows: NameChangedPreviewRow[] = [];
  const suggestedLinkRows: SuggestedLinkPreviewRow[] = [];
  let unchangedCount = 0;

  for (const row of rows) {
    if (dupedCodes.has(row.code)) continue;
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

  return { totalRows: rows.length, unchangedCount, newRows, nameChangedRows, suggestedLinkRows, duplicateGroups, missingItems };
}

export type JustCatalogApplyDecisions = {
  newRows: JustCatalogParsedRow[];
  nameChangedDecisions: { itemId: string; code: string; justName: string; useJustName: boolean }[];
  suggestedLinkDecisions: { itemId: string; code: string; name: string; link: boolean }[];
  // Códigos que Daniel confirmó crear a partir de un grupo duplicado
  // (uno solo si eligió "mantener este código", todos los no vinculados
  // si confirmó "son productos distintos") — ver classifyJustCatalogRows.
  duplicateGroupDecisions: { code: string; name: string }[];
  duplicateGroupsTotal: number;
  duplicateGroupsResolved: number;
  missingCount: number;
};

export async function applyJustCatalogImport(decisions: JustCatalogApplyDecisions, totalRows: number, importedById: string | null) {
  let createdCount = 0;
  let linkedCount = 0;
  let renamedCount = 0;

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

  return { createdCount, linkedCount, renamedCount };
}
