import { prisma } from "@/lib/prisma";
import { normalize, significantWords, findSimilarUnlinkedItem } from "@/lib/justCatalog";
import { generateComboSuggestions } from "@/lib/comboSuggestions";

// Confirmado 2026-08-31: registro manual de una lectura de atomapp.com.co —
// alguien del equipo de Análisis de Mercado la pega tal cual (Ctrl+A/copiar
// la tabla completa, cuantas páginas quiera) en una sola caja de texto
// dentro de DAFLOW. Nunca corre por script/cron automático (no hay clave de
// ATOM guardada en ningún lado, ver memoria project_atom_combo_suggestions_idea).
// Solo se guardan los productos/combos marcados "Rentable" — "Seguimiento" e
// "Intervención" (un tercer estado real que ATOM usa) se descartan igual,
// confirmado explícito del usuario.

const STATUS_WORDS = new Set(["Rentable", "Seguimiento", "Intervención", "Intervencion"]);
// Líneas de la tabla que no son parte de ningún producto (encabezado repetido
// al inicio de cada página, pie de paginación) — se saltan cuando aparecen
// donde se esperaba un nombre de producto.
const NOISE_LINES = new Set(["Accion", "Acción", "Filas por página"]);

// Cada producto en el texto pegado sigue siempre el mismo patrón (confirmado
// 2026-08-31 contra una muestra real): nombre -> estado -> 7 grupos de 3
// líneas (porcentaje, "Pedidos: N", "Productos: N"), una por cada columna
// (Generados/Entregados/Por Confirmar/Pendientes/En curso/En novedad/
// Devoluciones). Después del último grupo viene el siguiente nombre.
const METRIC_GROUPS = 7;
const LINES_PER_METRIC_GROUP = 3;

export function parseAtomPastedTable(raw: string): string[] {
  const lines = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !NOISE_LINES.has(l));

  const rentableNames: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const nameLine = lines[i];
    // Una línea de estado (o de encabezado) no puede ser el nombre de un
    // producto — si aparece donde se esperaba un nombre, algo no calzó
    // (fila incompleta al final del texto pegado); se descarta el resto.
    if (STATUS_WORDS.has(nameLine)) {
      i++;
      continue;
    }
    const statusLine = lines[i + 1];
    if (statusLine === undefined || !STATUS_WORDS.has(statusLine)) {
      // No hay una línea de estado válida justo después — no es un
      // producto reconocible, se avanza una línea e intenta de nuevo.
      i++;
      continue;
    }
    const metricLinesStart = i + 2;
    const metricLinesEnd = metricLinesStart + METRIC_GROUPS * LINES_PER_METRIC_GROUP;
    if (metricLinesEnd > lines.length) break; // fila cortada a medias, no hay más que leer

    if (statusLine === "Rentable") rentableNames.push(nameLine);
    i = metricLinesEnd;
  }

  // Mismo nombre puede repetirse varias veces en el pegado (distintas
  // páginas/filtros) — solo interesa que esté marcado Rentable al menos una
  // vez, no cuántas.
  return [...new Set(rentableNames)];
}

export type AtomSyncMatchedCombo = {
  id: string;
  code: string;
  label: string;
  matchType: "exact" | "similar";
  components: { catalogItemId: string; name: string; quantity: number }[];
};

export type AtomSyncPreviewRow = {
  productName: string;
  matchedItemId: string | null;
  matchedItemName: string | null;
  matchType: "exact" | "similar" | "none";
  matchedCombo: AtomSyncMatchedCombo | null;
};

// Confirmado 2026-09-02 (pedido explícito del usuario): un combo de Dropi
// nunca es un producto real de Just, así que nunca va a matchear contra el
// catálogo — por eso solo se busca combo cuando NO hubo match de producto.
// La búsqueda reusa el mismo criterio por nombre que ya usa
// /api/combo-suggestions/dropi-combo-match (label del combo, nunca su código
// real de Dropi — ese no aparece en el texto pegado de ATOM). Esto es lo que
// hace que la vista previa "aprenda" con el tiempo: mientras más combos
// registre Daniel en Base de datos de productos, menos filas quedan "Sin
// resolver" en cada pegado nuevo — pero como el label es solo una referencia
// de Daniel (no un identificador confiable), la persona que pega ATOM
// siempre confirma "sí, es este" antes de guardarlo, nunca se auto-vincula.
export async function previewAtomSync(productNames: string[]): Promise<AtomSyncPreviewRow[]> {
  const [catalogItems, dropiCombos] = await Promise.all([
    prisma.purchaseCatalogItem.findMany({ select: { id: true, name: true } }),
    prisma.dropiCombo.findMany({
      where: { label: { not: null } },
      include: { components: { include: { catalogItem: { select: { id: true, name: true } } } } },
    }),
  ]);
  const byNormalizedName = new Map(catalogItems.map((i) => [normalize(i.name), i]));
  const withWords = catalogItems.map((i) => ({ id: i.id, name: i.name, words: significantWords(i.name) }));

  const labeledCombos = dropiCombos.filter((c): c is typeof c & { label: string } => c.label !== null);
  const comboWords = labeledCombos.map((c) => ({ id: c.id, name: c.label, words: significantWords(c.label) }));

  function findMatchedCombo(productName: string): AtomSyncMatchedCombo | null {
    const exact = labeledCombos.find((c) => normalize(c.label) === normalize(productName));
    const similarId = exact ? null : findSimilarUnlinkedItem(significantWords(productName), comboWords)?.id;
    const found = exact ?? (similarId ? labeledCombos.find((c) => c.id === similarId) : undefined);
    if (!found) return null;
    return {
      id: found.id,
      code: found.code,
      label: found.label,
      matchType: exact ? "exact" : "similar",
      components: found.components.map((c) => ({ catalogItemId: c.catalogItemId, name: c.catalogItem.name, quantity: c.quantity })),
    };
  }

  return productNames.map((productName) => {
    const exact = byNormalizedName.get(normalize(productName));
    if (exact) return { productName, matchedItemId: exact.id, matchedItemName: exact.name, matchType: "exact" as const, matchedCombo: null };
    const similar = findSimilarUnlinkedItem(significantWords(productName), withWords);
    if (similar) return { productName, matchedItemId: similar.id, matchedItemName: similar.name, matchType: "similar" as const, matchedCombo: null };
    return { productName, matchedItemId: null, matchedItemName: null, matchType: "none" as const, matchedCombo: findMatchedCombo(productName) };
  });
}

// Decisión final por fila, tomada por la persona que confirma la vista
// previa: o se enlaza a un producto real del catálogo (confirmedMatchedItemId),
// o se marca explícitamente como combo (isCombo=true, sin enlace — un combo
// de Dropi no existe como PurchaseCatalogItem propio, ver DropiCombo).
export type AtomSyncConfirmedRow = { productName: string; confirmedMatchedItemId: string | null; isCombo: boolean };

// Guarda la lectura confirmada (una fila nueva por producto, nunca se
// sobrescribe lo anterior — así se acumula el historial real) y dispara la
// generación de sugerencias con los datos frescos.
export async function applyAtomSync(rows: AtomSyncConfirmedRow[], capturedAt: Date, createdById: string | null, createdByName: string | null, comboActorId: string): Promise<{ savedCount: number; suggestionsCreated: number }> {
  await prisma.atomProductStatus.createMany({
    data: rows.map((r) => ({
      productName: r.productName,
      status: "RENTABLE" as const,
      isCombo: r.isCombo,
      matchedCatalogItemId: r.isCombo ? null : r.confirmedMatchedItemId,
      capturedAt,
      createdById,
      createdByName,
    })),
  });
  const { created } = await generateComboSuggestions(comboActorId);
  return { savedCount: rows.length, suggestionsCreated: created };
}
