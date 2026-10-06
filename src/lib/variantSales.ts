import { prisma } from "@/lib/prisma";

export { MIX_MIN_UNITS, splitByVariant } from "@/lib/variantMix";

// "Ventas por variante" (etapa 1, pedido del usuario 2026-10-05): qué color /
// talla de cada producto sale más, leído de las notas de variante que ya se
// guardan de las guías de cada corte (FulfillmentRequestVariantNote, desde
// 2026-09-26). Solo lectura: el stock sigue siendo uno por producto (regla
// del 2026-09-21); el stock por variante es la etapa 3, todavía no existe.
//
// Lo que NO es variante y se deja fuera del reparto:
// - "Sin variante" / "Sin leer en guías": relleno para que la suma cuadre.
// - "Paquete de N": es cuántas unidades lleva el pedido, el mismo artículo.

const DAY_MS = 86_400_000;
const FILLER = /^(sin variante|sin leer en gu[ií]as)$/i;
const PACK = /^paquete de \d+$/i;

// Tallas escritas distinto en cada transportadora ("L-XL", "L XL", "l/xl",
// ".xl", "2XL") cuentan como una sola. Los colores solo se igualan en
// mayúsculas/minúsculas y espacios.
const SIZE = /^(xs|s|m|l|xl|xxl|xxxl|\d?xl)$/i;
function canonSize(p: string): string {
  const u = p.toUpperCase();
  if (u === "2XL") return "XXL";
  if (u === "3XL") return "XXXL";
  return u;
}

export function canonicalVariantLabel(raw: string): string | null {
  const label = raw.replace(/^Combo \S+:\s*/i, "").replace(/\*+/g, "").replace(/\s+/g, " ").trim();
  if (!label || FILLER.test(label) || PACK.test(label)) return null;
  const sizeTokens = label.replace(/^[.\s]+/, "").split(/[\s/-]+/).filter(Boolean);
  if (sizeTokens.length > 0 && sizeTokens.every((t) => SIZE.test(t))) return sizeTokens.map(canonSize).join("/");
  return label
    .split(/\s*\/\s*/)
    .map((part) => {
      const p = part.replace(/^[.\s]+/, "");
      return SIZE.test(p) ? canonSize(p) : p.toLowerCase().replace(/(^|\s)\S/g, (c) => c.toUpperCase());
    })
    .join(" / ");
}

// Une lo que dicen las guías con la lista oficial del conteo (2026-10-06):
// primero lo que Daniel ya decidió ("Gris7cafe" → Gris con café, o "No es un
// color" = null); si no, el mismo nombre de la lista sin importar
// mayúsculas; si no, el nombre limpio tal cual (todavía sin decidir, o el
// producto aún no tiene lista oficial).
export async function getVariantResolver(catalogItemIds?: string[]): Promise<(catalogItemId: string, rawLabel: string) => string | null> {
  const where = catalogItemIds ? { catalogItemId: { in: catalogItemIds } } : {};
  const [official, aliases] = await Promise.all([
    prisma.productVariant.findMany({ where, select: { catalogItemId: true, name: true } }),
    prisma.productVariantAlias.findMany({ where, select: { catalogItemId: true, label: true, ignored: true, variant: { select: { name: true } } } }),
  ]);
  const officialBy = new Map<string, string>();
  for (const v of official) officialBy.set(`${v.catalogItemId}|${v.name.toLowerCase()}`, v.name);
  const aliasBy = new Map<string, string | null>();
  for (const a of aliases) aliasBy.set(`${a.catalogItemId}|${a.label.toLowerCase()}`, a.ignored ? null : (a.variant?.name ?? null));
  return (catalogItemId, rawLabel) => {
    const label = canonicalVariantLabel(rawLabel);
    if (!label) return null;
    const key = `${catalogItemId}|${label.toLowerCase()}`;
    if (aliasBy.has(key)) return aliasBy.get(key)!;
    return officialBy.get(key) ?? label;
  };
}

// Variantes de las guías que no coinciden con la lista oficial de su
// producto y que Daniel todavía no unió (solo productos que ya tienen lista,
// o sea, ya contados por variante).
export type UnmatchedGuideVariant = { catalogItemId: string; name: string; justCode: string | null; photo: string | null; label: string; units: number; official: { id: string; name: string }[] };

export async function getUnmatchedGuideVariants(): Promise<UnmatchedGuideVariant[]> {
  const official = await prisma.productVariant.findMany({ select: { id: true, catalogItemId: true, name: true }, orderBy: [{ countedQty: { sort: "desc", nulls: "last" } }, { name: "asc" }] });
  if (official.length === 0) return [];
  const itemIds = [...new Set(official.map((v) => v.catalogItemId))];
  const [notes, aliases, items] = await Promise.all([
    prisma.fulfillmentRequestVariantNote.groupBy({ by: ["catalogItemId", "label"], where: { catalogItemId: { in: itemIds } }, _sum: { quantity: true } }),
    prisma.productVariantAlias.findMany({ where: { catalogItemId: { in: itemIds } }, select: { catalogItemId: true, label: true } }),
    prisma.purchaseCatalogItem.findMany({ where: { id: { in: itemIds } }, select: { id: true, name: true, justCode: true, photos: true } }),
  ]);
  const decided = new Set(aliases.map((a) => `${a.catalogItemId}|${a.label.toLowerCase()}`));
  const known = new Set(official.map((v) => `${v.catalogItemId}|${v.name.toLowerCase()}`));
  const units = new Map<string, { catalogItemId: string; label: string; units: number }>();
  for (const n of notes) {
    const label = canonicalVariantLabel(n.label);
    if (!label) continue;
    const key = `${n.catalogItemId}|${label.toLowerCase()}`;
    if (decided.has(key) || known.has(key)) continue;
    const u = units.get(key) ?? { catalogItemId: n.catalogItemId, label, units: 0 };
    u.units += n._sum.quantity ?? 0;
    units.set(key, u);
  }
  const itemBy = new Map(items.map((i) => [i.id, i]));
  return [...units.values()]
    .map((u) => {
      const item = itemBy.get(u.catalogItemId);
      return {
        ...u,
        name: item?.name ?? "Producto",
        justCode: item?.justCode ?? null,
        photo: item?.photos[0] ?? null,
        official: official.filter((v) => v.catalogItemId === u.catalogItemId).map((v) => ({ id: v.id, name: v.name })),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name) || b.units - a.units);
}

// Daniel decide a cuál corresponde: una de la lista, un color nuevo (se
// agrega a la lista) o "No es un color".
export async function decideGuideVariant(params: { catalogItemId: string; label: string; variantId?: string | null; newVariant?: boolean; ignore?: boolean; userId: string | null }): Promise<{ ok: true } | { ok: false; error: string }> {
  const label = canonicalVariantLabel(params.label);
  if (!label) return { ok: false, error: "Ese nombre no es una variante." };
  let variantId: string | null = null;
  if (params.variantId) {
    const v = await prisma.productVariant.findUnique({ where: { id: params.variantId }, select: { catalogItemId: true } });
    if (v?.catalogItemId !== params.catalogItemId) return { ok: false, error: "Esa variante no es de este producto." };
    variantId = params.variantId;
  } else if (params.newVariant) {
    const v = await prisma.productVariant.upsert({
      where: { catalogItemId_name: { catalogItemId: params.catalogItemId, name: label } },
      update: {},
      create: { catalogItemId: params.catalogItemId, name: label },
    });
    variantId = v.id;
  } else if (!params.ignore) {
    return { ok: false, error: "Elige a cuál corresponde." };
  }
  await prisma.productVariantAlias.upsert({
    where: { catalogItemId_label: { catalogItemId: params.catalogItemId, label } },
    update: { variantId, ignored: !variantId, decidedById: params.userId, decidedAt: new Date() },
    create: { catalogItemId: params.catalogItemId, label, variantId, ignored: !variantId, decidedById: params.userId },
  });
  return { ok: true };
}

export type VariantShare ={ label: string; units: number; pct: number; trend: "up" | "down" | null };
export type VariantProduct = {
  catalogItemId: string;
  name: string;
  justCode: string | null;
  photo: string | null;
  // Unidades del producto que salieron en el período (con o sin variante leída).
  totalUnits: number;
  // De esas, cuántas traían color/talla leído.
  variantUnits: number;
  variants: VariantShare[];
};

// Tendencia: se compara la participación de la variante en la mitad reciente
// del período contra la mitad anterior. Solo se marca si cambió 10 puntos o
// más y cada mitad tiene al menos 10 unidades con variante (con menos, es
// ruido).
const TREND_POINTS = 10;
const TREND_MIN_UNITS = 10;

export async function getVariantSales(opts: { days: number; catalogItemIds?: string[] }): Promise<{ since: string; products: VariantProduct[] }> {
  const now = Date.now();
  const since = new Date(now - opts.days * DAY_MS);
  const mid = new Date(now - (opts.days * DAY_MS) / 2);
  const itemFilter = opts.catalogItemIds ? { catalogItemId: { in: opts.catalogItemIds } } : {};

  const [notes, totals, resolve] = await Promise.all([
    prisma.fulfillmentRequestVariantNote.findMany({
      where: { ...itemFilter, batch: { requestedAt: { gte: since } } },
      select: { catalogItemId: true, label: true, quantity: true, batch: { select: { requestedAt: true } } },
    }),
    // Mismo criterio de "venta" que Qué comprar: una garantía de solo una
    // pieza sale del stock de repuestos, no cuenta.
    prisma.fulfillmentRequestItem.groupBy({
      by: ["catalogItemId"],
      where: { ...itemFilter, batch: { requestedAt: { gte: since } }, warrantyGuide: null },
      _sum: { quantity: true },
    }),
    getVariantResolver(opts.catalogItemIds),
  ]);

  type Acc = { units: number; recent: number; older: number };
  const byItem = new Map<string, Map<string, Acc>>();
  for (const n of notes) {
    const label = resolve(n.catalogItemId, n.label);
    if (!label || n.quantity <= 0) continue;
    let m = byItem.get(n.catalogItemId);
    if (!m) byItem.set(n.catalogItemId, (m = new Map()));
    const a = m.get(label) ?? { units: 0, recent: 0, older: 0 };
    a.units += n.quantity;
    if (n.batch.requestedAt >= mid) a.recent += n.quantity;
    else a.older += n.quantity;
    m.set(label, a);
  }
  if (byItem.size === 0) return { since: since.toISOString(), products: [] };

  const totalByItem = new Map(totals.map((t) => [t.catalogItemId, t._sum.quantity ?? 0]));
  const items = await prisma.purchaseCatalogItem.findMany({
    where: { id: { in: [...byItem.keys()] } },
    select: { id: true, name: true, justCode: true, photos: true },
  });

  const products: VariantProduct[] = items.map((item) => {
    const m = byItem.get(item.id)!;
    const variantUnits = [...m.values()].reduce((s, a) => s + a.units, 0);
    const recentTotal = [...m.values()].reduce((s, a) => s + a.recent, 0);
    const olderTotal = [...m.values()].reduce((s, a) => s + a.older, 0);
    const canTrend = recentTotal >= TREND_MIN_UNITS && olderTotal >= TREND_MIN_UNITS;
    const variants = [...m.entries()]
      .map(([label, a]): VariantShare => {
        let trend: VariantShare["trend"] = null;
        if (canTrend) {
          const diff = (a.recent / recentTotal - a.older / olderTotal) * 100;
          if (diff >= TREND_POINTS) trend = "up";
          else if (diff <= -TREND_POINTS) trend = "down";
        }
        return { label, units: a.units, pct: Math.round((a.units / variantUnits) * 100), trend };
      })
      .sort((a, b) => b.units - a.units || a.label.localeCompare(b.label));
    return {
      catalogItemId: item.id,
      name: item.name,
      justCode: item.justCode,
      photo: item.photos[0] ?? null,
      totalUnits: Math.max(totalByItem.get(item.id) ?? 0, variantUnits),
      variantUnits,
      variants,
    };
  });
  products.sort((a, b) => b.variantUnits - a.variantUnits);
  return { since: since.toISOString(), products };
}

// Nombres de color/talla sugeridos para contar cada producto (conteo por
// variante, 2026-10-06): primero los que ya quedaron de un conteo aprobado,
// luego los que salieron en las guías (de más a menos vendido). Solo
// nombres, nunca cantidades: el conteo es a ciegas.
export async function variantSuggestions(catalogItemIds: string[]): Promise<Map<string, string[]>> {
  if (catalogItemIds.length === 0) return new Map();
  const [official, notes, resolve] = await Promise.all([
    prisma.productVariant.findMany({ where: { catalogItemId: { in: catalogItemIds } }, orderBy: [{ countedQty: { sort: "desc", nulls: "last" } }, { name: "asc" }], select: { catalogItemId: true, name: true } }),
    prisma.fulfillmentRequestVariantNote.groupBy({ by: ["catalogItemId", "label"], where: { catalogItemId: { in: catalogItemIds } }, _sum: { quantity: true } }),
    getVariantResolver(catalogItemIds),
  ]);
  const fromGuides = new Map<string, Map<string, number>>();
  for (const n of notes) {
    const label = resolve(n.catalogItemId, n.label);
    if (!label) continue;
    let m = fromGuides.get(n.catalogItemId);
    if (!m) fromGuides.set(n.catalogItemId, (m = new Map()));
    m.set(label, (m.get(label) ?? 0) + (n._sum.quantity ?? 0));
  }
  const out = new Map<string, string[]>();
  const add = (id: string, name: string) => {
    const list = out.get(id) ?? [];
    if (!list.some((x) => x.toLowerCase() === name.toLowerCase())) list.push(name);
    out.set(id, list);
  };
  for (const v of official) add(v.catalogItemId, v.name);
  for (const [id, m] of fromGuides) for (const [label] of [...m].sort((a, b) => b[1] - a[1])) add(id, label);
  return out;
}
