import type { OutflowManifestRow } from "@/lib/merchandiseOutflowAi";

export const CONFIDENCE_RANK = { alta: 2, media: 1, baja: 0 } as const;
export type Confidence = keyof typeof CONFIDENCE_RANK;
const RANK_TO_CONFIDENCE: Confidence[] = ["baja", "media", "alta"];

export type CatalogItemLite = { id: string; name: string; photos: string[]; justCode: string | null; pendingRegistration: boolean };
export type ComboLite = { code: string; components: { quantity: number; catalogItem: CatalogItemLite }[] };
export type OutflowRowGroup = { name: string; quantity: number; confidence: Confidence; catalogItem: CatalogItemLite | null; unrecognizedCode: string | null; fromCombo: string | null };

// Extraído de extract/route.ts para poder probarlo directo (sin servidor
// HTTP ni sesión) contra datos marcados (ZZDBG_...) — ver
// project_registro_de_egresos_feature.md.
//
// Confirmado 2026-08-26 (pedido explícito del usuario): un ID de combo de
// Dropi NO es un producto real — empaqueta varios productos reales de Just
// en cantidades fijas (ver DropiCombo). Si el código leído en un renglón es
// un combo conocido, ese renglón se desglosa en sus componentes reales
// ANTES de agruparse, en vez de tratarse como un solo producto. Si no es un
// combo, se prioriza el match exacto por código Just sobre el match por
// nombre (más confiable, no depende de interpretar el nombre a mano).
export function groupOutflowRows(
  rows: OutflowManifestRow[],
  maps: { catalogByJustCode: Map<string, CatalogItemLite>; catalogByName: Map<string, CatalogItemLite>; combosByCode: Map<string, ComboLite> }
): OutflowRowGroup[] {
  const groups = new Map<string, OutflowRowGroup>();

  function addToGroup(key: string, value: Omit<OutflowRowGroup, "unrecognizedCode" | "fromCombo"> & { unrecognizedCode?: string | null; fromCombo?: string | null }) {
    const existing = groups.get(key);
    if (existing) {
      existing.quantity += value.quantity;
      existing.confidence = RANK_TO_CONFIDENCE[Math.min(CONFIDENCE_RANK[existing.confidence], CONFIDENCE_RANK[value.confidence])];
      if (!existing.unrecognizedCode && value.unrecognizedCode) existing.unrecognizedCode = value.unrecognizedCode;
    } else {
      groups.set(key, { unrecognizedCode: null, fromCombo: null, ...value });
    }
  }

  for (const row of rows) {
    const combo = row.code ? maps.combosByCode.get(row.code.trim().toLowerCase()) : undefined;
    if (combo) {
      for (const comp of combo.components) {
        addToGroup(`cat:${comp.catalogItem.id}`, {
          name: comp.catalogItem.name,
          quantity: comp.quantity * row.quantity,
          confidence: row.confidence,
          catalogItem: comp.catalogItem,
          fromCombo: combo.code,
        });
      }
      continue;
    }

    const matched = (row.code ? maps.catalogByJustCode.get(row.code.trim().toLowerCase()) : undefined) ?? (row.catalogMatch ? maps.catalogByName.get(row.catalogMatch.trim().toLowerCase()) : undefined);
    const key = matched ? `cat:${matched.id}` : `manual:${row.name.trim().toLowerCase()}`;
    addToGroup(key, {
      name: matched ? matched.name : row.name,
      quantity: row.quantity,
      confidence: row.confidence,
      catalogItem: matched ?? null,
      unrecognizedCode: !matched && row.code ? row.code : null,
    });
  }

  return Array.from(groups.values());
}
