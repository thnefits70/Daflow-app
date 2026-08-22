import { prisma } from "@/lib/prisma";

export type JustCatalogParsedRow = { code: string; name: string };

function normalize(s: string): string {
  return s.trim().replace(/\s+/g, " ").toUpperCase();
}

export type NameChangedPreviewRow = { code: string; itemId: string; currentName: string; justName: string };
export type SuggestedLinkPreviewRow = { code: string; name: string; itemId: string; existingName: string };

export type JustCatalogPreview = {
  totalRows: number;
  unchangedCount: number;
  newRows: JustCatalogParsedRow[];
  nameChangedRows: NameChangedPreviewRow[];
  suggestedLinkRows: SuggestedLinkPreviewRow[];
  duplicateNameWarnings: string[];
};

// Clasifica cada fila del export de Just contra el catálogo ya existente —
// confirmado 2026-08-21 (varias rondas de preguntas antes de tocar código):
// - justCode ya vinculado y el nombre coincide -> "unchanged", no hace falta
//   ninguna decisión.
// - justCode ya vinculado pero el nombre cambió en Just -> "nameChanged",
//   Daniel decide fila por fila si actualiza el nombre en DAFLOW o lo deja
//   como está (nunca se auto-decide, para no romper fotos/historial de un
//   producto por un cambio de nombre en Just).
// - código nuevo pero el nombre coincide EXACTO (sin distinguir mayúsculas/
//   espacios extra) con un producto existente sin justCode -> "suggestedLink",
//   Daniel confirma el vínculo o lo trata como un producto aparte. Solo
//   coincidencia exacta normalizada, sin IA/fuzzy — barato y determinístico,
//   igual criterio que llevó a sacar el reconocimiento por IA de Reingreso
//   (ver catalog-search/route.ts).
// - código nuevo, nombre sin coincidencia -> "new", se crea automático como
//   esqueleto (sin fotos, pendingRegistration=true) — no necesita decisión
//   fila por fila, solo aparece contado/listado en la vista previa.
export async function classifyJustCatalogRows(rows: JustCatalogParsedRow[]): Promise<JustCatalogPreview> {
  const existingItems = await prisma.purchaseCatalogItem.findMany({
    select: { id: true, name: true, justCode: true, pendingRegistration: true },
  });
  const byJustCode = new Map(existingItems.filter((i) => i.justCode).map((i) => [i.justCode as string, i]));
  const byNormalizedName = new Map(existingItems.filter((i) => !i.justCode).map((i) => [normalize(i.name), i]));

  const nameCounts = new Map<string, string[]>();
  for (const row of rows) {
    const key = normalize(row.name);
    nameCounts.set(key, [...(nameCounts.get(key) ?? []), row.code]);
  }
  const duplicateNameWarnings = [...nameCounts.entries()]
    .filter(([, codes]) => codes.length > 1)
    .map(([, codes]) => {
      const sample = rows.find((r) => r.code === codes[0]);
      return `"${sample?.name ?? ""}" aparece ${codes.length} veces con códigos distintos (${codes.join(", ")}) — revisa que no sea el mismo producto repetido.`;
    });

  const newRows: JustCatalogParsedRow[] = [];
  const nameChangedRows: NameChangedPreviewRow[] = [];
  const suggestedLinkRows: SuggestedLinkPreviewRow[] = [];
  let unchangedCount = 0;

  for (const row of rows) {
    const linked = byJustCode.get(row.code);
    if (linked) {
      if (normalize(linked.name) === normalize(row.name)) {
        unchangedCount++;
      } else {
        nameChangedRows.push({ code: row.code, itemId: linked.id, currentName: linked.name, justName: row.name });
      }
      continue;
    }
    const suggested = byNormalizedName.get(normalize(row.name));
    if (suggested) {
      suggestedLinkRows.push({ code: row.code, name: row.name, itemId: suggested.id, existingName: suggested.name });
      continue;
    }
    newRows.push(row);
  }

  return { totalRows: rows.length, unchangedCount, newRows, nameChangedRows, suggestedLinkRows, duplicateNameWarnings };
}

export type JustCatalogApplyDecisions = {
  newRows: JustCatalogParsedRow[];
  nameChangedDecisions: { itemId: string; code: string; justName: string; useJustName: boolean }[];
  suggestedLinkDecisions: { itemId: string; code: string; name: string; link: boolean }[];
};

export async function applyJustCatalogImport(decisions: JustCatalogApplyDecisions, totalRows: number, importedById: string | null) {
  let createdCount = 0;
  let linkedCount = 0;
  let renamedCount = 0;

  await prisma.$transaction(async (tx) => {
    // `PurchaseCatalogItem.name` es @unique — el export real de Just trae
    // algunos nombres repetidos con código distinto (mismo nombre, dos SKU
    // reales). En vez de que la fila que llega segunda reviente la
    // transacción, se le agrega el código entre paréntesis para que ambas
    // queden registradas — Daniel puede renombrarla después si hace falta.
    const taken = new Set<string>();
    async function resolveUniqueName(desiredName: string, code: string): Promise<string> {
      const norm = normalize(desiredName);
      const collides = taken.has(norm) || !!(await tx.purchaseCatalogItem.findUnique({ where: { name: desiredName } }));
      if (!collides) {
        taken.add(norm);
        return desiredName;
      }
      const candidate = `${desiredName} (${code})`;
      taken.add(normalize(candidate));
      return candidate;
    }

    for (const row of decisions.newRows) {
      const name = await resolveUniqueName(row.name, row.code);
      await tx.purchaseCatalogItem.create({ data: { name, justCode: row.code, photos: [], pendingRegistration: true } });
      createdCount++;
    }

    for (const d of decisions.suggestedLinkDecisions) {
      if (d.link) {
        await tx.purchaseCatalogItem.update({ where: { id: d.itemId }, data: { justCode: d.code } });
        linkedCount++;
      } else {
        const name = await resolveUniqueName(d.name, d.code);
        await tx.purchaseCatalogItem.create({ data: { name, justCode: d.code, photos: [], pendingRegistration: true } });
        createdCount++;
      }
    }

    for (const d of decisions.nameChangedDecisions) {
      if (d.useJustName) {
        const name = await resolveUniqueName(d.justName, d.code);
        await tx.purchaseCatalogItem.update({ where: { id: d.itemId }, data: { name } });
        renamedCount++;
      }
    }
  });

  await prisma.justCatalogImport.create({
    data: { importedById, totalRows, createdCount, linkedCount, renamedCount },
  });

  return { createdCount, linkedCount, renamedCount };
}
