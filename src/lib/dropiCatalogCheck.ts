import { unstable_cache } from "next/cache";
import { prisma } from "@/lib/prisma";
import { McpSession, toolText } from "@/lib/nick/dropiMcp";
import { getValidAccessToken } from "@/lib/nick/dropiOAuth";
import { currentDropiPrices } from "@/lib/dropiPriceChanges";
import { getVariantStock } from "@/lib/variantStock";

// Stock y precio en Dropi vs INVESTOCK (pedido del usuario 2026-10-17, con las
// cuentas de proveedor ya conectadas en NICK). Meta del equipo: 1000 pedidos
// diarios, así que todo lo que tenemos debe estar publicado y vendiéndose.
// Los productos PRIVADOS en Dropi no salen en su catálogo (confirmado 2026-10-17
// con el 200579 y el 177633), así que no se pueden revisar aquí.
// - "precio_bajo" (urgente): el precio en Dropi está por debajo del Precio Dropi
//   de INVESTOCK (el de Stock Actual, que sube o baja solo con compras y
//   devoluciones) → se pierde margen. Lo ven la asesora B2B y Yair.
// - "subir_stock" (urgente): hay mercadería en bodega y Dropi muestra poco o
//   nada → se queda sin vender. Por producto y por color/talla cuando la
//   variante tiene su ID de variación de Dropi (las organiza Daniel).
// - "revisar_stock": Dropi publica más de lo que hay y se está vendiendo; no es
//   para frenar la venta (compras repone), solo para que la asesora lo tenga a
//   la vista.
// El catálogo de Dropi se lee como mucho cada 2 horas (4 lecturas de 100 por
// cuenta) y se guarda en caché; "Ya actualicé Dropi" lo vuelve a leer al instante.

export const DROPI_CATALOG_TAG = "dropi-catalog";

// Importadora Shanghai NO se revisa (confirmado por el dueño 2026-10-17): son
// importados que se venden de forma privada, con precio fijo y un solo ingreso
// de stock por ID hasta agotarse. Además Dropi no deja leer productos privados.
const ACCOUNTS = [
  { id: "nick_acc_provedix", bodega: "MKT_PROVEDIX", brand: "Provedix" },
  {
    id: "nick_acc_importadora_damian",
    bodega: "MKT_DAMIAN",
    brand: "Importadora Damián",
  },
] as const;

type DropiVariation = { id: string; stock: number };
type DropiProduct = {
  id: string;
  name: string;
  salePrice: number | null;
  stock: number;
  variations: DropiVariation[];
};
type DropiCatalog = {
  readAt: string;
  accounts: { id: string; products: DropiProduct[]; error: string | null }[];
};

// El catálogo llega como texto con sangrías ("  - id:" producto, "      - id:" variación).
export function parseDropiCatalog(text: string): DropiProduct[] {
  const out: DropiProduct[] = [];
  let p: DropiProduct | null = null;
  let v: DropiVariation | null = null;
  const num = (s: string) => {
    const n = Number(s.trim().replace(/^"|"$/g, ""));
    return Number.isFinite(n) ? n : null;
  };
  for (const line of text.split("\n")) {
    let m = line.match(/^ {2}- id: (\d+)/);
    if (m) {
      p = { id: m[1], name: "", salePrice: null, stock: 0, variations: [] };
      v = null;
      out.push(p);
      continue;
    }
    if (!p) continue;
    m = line.match(/^ {6}- id: (\d+)/);
    if (m) {
      v = { id: m[1], stock: 0 };
      p.variations.push(v);
      continue;
    }
    m = line.match(/^ {8}stock: (-?\d+)/);
    if (m && v) {
      v.stock = Number(m[1]);
      continue;
    }
    m = line.match(/^ {4}(name|sale_price|stock): (.*)$/);
    if (m) {
      if (m[1] === "name") p.name = m[2].trim().replace(/^"|"$/g, "");
      else if (m[1] === "sale_price") p.salePrice = num(m[2]);
      else p.stock = num(m[2]) ?? 0;
    }
  }
  // Con variaciones, el stock publicado es la suma de las variaciones.
  for (const x of out)
    if (x.variations.length)
      x.stock = x.variations.reduce((s, y) => s + Math.max(0, y.stock), 0);
  return out;
}

async function readAccountCatalog(accountId: string): Promise<DropiProduct[]> {
  const mcp = new McpSession(accountId, await getValidAccessToken(accountId));
  await mcp.init();
  const all = new Map<string, DropiProduct>();
  // "start_data" es el número de página desde 1 (0 repite la 1), probado
  // 2026-10-17; orden por ID para que las páginas no se crucen.
  for (let page = 1; page <= 15; page++) {
    const text = toolText(
      await mcp.callTool("list_products", {
        get_stock: true,
        page_size: 100,
        start_data: page,
        order_by: "id",
        order_type: "asc",
      }),
    );
    if (/respondió 4\d\d/.test(text)) throw new Error(text.slice(0, 160));
    const items = parseDropiCatalog(text);
    for (const p of items) all.set(p.id, p);
    const count = Number((text.match(/count: (\d+)/) ?? [])[1] ?? 0);
    if (items.length < 100 || all.size >= count) break;
  }
  return [...all.values()];
}

export async function readDropiCatalogs(): Promise<DropiCatalog> {
  const accounts = await Promise.all(
    ACCOUNTS.map(async (a) => {
      try {
        return {
          id: a.id,
          products: await readAccountCatalog(a.id),
          error: null,
        };
      } catch (e) {
        return {
          id: a.id,
          products: [],
          error: String((e as Error).message ?? e).slice(0, 200),
        };
      }
    }),
  );
  return { readAt: new Date().toISOString(), accounts };
}

const cachedCatalog = unstable_cache(readDropiCatalogs, ["dropi-catalog-v1"], {
  revalidate: 2 * 3600,
  tags: [DROPI_CATALOG_TAG],
});

export type DropiCheckKind = "precio_bajo" | "subir_stock" | "revisar_stock";
export type DropiCheck = {
  kind: DropiCheckKind;
  code: string;
  name: string;
  brand: string;
  variant: string | null;
  realStock: number;
  dropiStock: number;
  sold30: number;
  dropiPrice: number | null;
  minPrice: number | null;
};
export type DropiChecks = {
  readAt: string;
  checks: DropiCheck[];
  errors: string[];
};

const MIN_REAL_TO_PUBLISH = 5;

// Pedidos de los últimos 30 días por ID: guías de nuestros cortes que llevan ese producto.
async function ordersByCode(codes: string[]): Promise<Map<string, number>> {
  if (!codes.length) return new Map();
  const since = new Date(Date.now() - 30 * 86_400_000 - 5 * 3_600_000).toISOString().slice(0, 10);
  const rows = await prisma.$queryRaw<{ code: string; n: number }[]>`
    SELECT c AS code, count(*)::int AS n
    FROM "FulfillmentRequestGuide", unnest(codes) AS c
    WHERE "manifestDay" >= ${since} AND c = ANY(${codes})
    GROUP BY c`;
  return new Map(rows.map((r) => [r.code, r.n]));
}

export const getCachedDropiCatalogChecks = unstable_cache(
  () => getDropiCatalogChecks(),
  ["dropi-catalog-checks-v1"],
  { revalidate: 30 * 60, tags: [DROPI_CATALOG_TAG] },
);

export async function getDropiCatalogChecks(
  fresh?: DropiCatalog,
): Promise<DropiChecks> {
  const catalog = fresh ?? (await cachedCatalog());
  const checks: DropiCheck[] = [];
  const errors = catalog.accounts
    .filter((a) => a.error)
    .map(
      (a) =>
        `${ACCOUNTS.find((x) => x.id === a.id)?.brand ?? a.id}: ${a.error}`,
    );

  for (const acc of ACCOUNTS) {
    const products =
      catalog.accounts.find((a) => a.id === acc.id)?.products ?? [];
    if (!products.length) continue;
    const items = await prisma.purchaseCatalogItem.findMany({
      where: {
        bodega: acc.bodega,
        justCode: { in: products.map((p) => p.id) },
      },
      select: { id: true, justCode: true, name: true },
    });
    if (!items.length) continue;
    const ids = items.map((i) => i.id);
    const [latest, variants, sales, minPrices] = await Promise.all([
      prisma.stockKardexEntry.findMany({
        where: { catalogItemId: { in: ids } },
        distinct: ["catalogItemId"],
        orderBy: [
          { catalogItemId: "asc" },
          { occurredAt: "desc" },
          { createdAt: "desc" },
        ],
        select: { catalogItemId: true, balanceAfter: true },
      }),
      getVariantStock(ids),
      ordersByCode(items.map((i) => i.justCode!)),
      currentDropiPrices(ids),
    ]);
    const realBy = new Map(
      latest.map((k) => [k.catalogItemId, Math.max(0, k.balanceAfter)]),
    );
    const byCode = new Map(products.map((p) => [p.id, p]));
    for (const item of items) {
      const p = byCode.get(item.justCode!);
      if (!p) continue;
      const real = realBy.get(item.id) ?? 0;
      const sold30 = sales.get(item.justCode!) ?? 0;
      const min = minPrices.get(item.id) ?? null;
      const minPrice = min != null ? Math.round(min * 100) / 100 : null;
      const base = {
        code: item.justCode!,
        name: item.name,
        brand: acc.brand,
        sold30,
        dropiPrice: p.salePrice,
        minPrice,
      };
      if (
        p.salePrice != null &&
        minPrice != null &&
        p.salePrice < minPrice - 0.005
      )
        checks.push({
          ...base,
          kind: "precio_bajo",
          variant: null,
          realStock: real,
          dropiStock: p.stock,
        });
      // Por color/talla, solo donde Daniel ya puso el ID de variación de Dropi.
      const mapped = (variants.get(item.id)?.variants ?? []).filter(
        (v) => v.dropiVariantId,
      );
      const dropiVar = new Map(p.variations.map((v) => [v.id, v.stock]));
      let variantFlagged = false;
      for (const v of mapped) {
        const dv = dropiVar.get(v.dropiVariantId!);
        if (dv == null) continue;
        if (
          v.stock >= MIN_REAL_TO_PUBLISH &&
          (dv <= 0 || dv <= v.stock * 0.5)
        ) {
          checks.push({
            ...base,
            kind: "subir_stock",
            variant: v.name,
            realStock: v.stock,
            dropiStock: Math.max(0, dv),
          });
          variantFlagged = true;
        }
      }
      if (
        !variantFlagged &&
        real >= MIN_REAL_TO_PUBLISH &&
        (p.stock <= 0 || p.stock <= real * 0.5)
      )
        checks.push({
          ...base,
          kind: "subir_stock",
          variant: null,
          realStock: real,
          dropiStock: Math.max(0, p.stock),
        });
      // Se vende y Dropi muestra más de lo que hay, con menos de una semana de stock real.
      if (sold30 > 0 && p.stock > real && real < (sold30 / 30) * 7)
        checks.push({
          ...base,
          kind: "revisar_stock",
          variant: null,
          realStock: real,
          dropiStock: p.stock,
        });
    }
  }
  const order: Record<DropiCheckKind, number> = {
    precio_bajo: 0,
    subir_stock: 1,
    revisar_stock: 2,
  };
  checks.sort(
    (a, b) =>
      order[a.kind] - order[b.kind] ||
      b.sold30 - a.sold30 ||
      b.realStock - a.realStock,
  );
  return { readAt: catalog.readAt, checks, errors };
}

// Quién corrige (pedido del usuario 2026-10-17): Michelle (asesora B2B, por su
// permiso "Publicar en Dropi"), Bryan Ríos y Yair. Cada ID se le asigna
// siempre a la misma persona para que no se crucen; cuando se corrige en Dropi
// desaparece de la lista de todos y cada uno puede ayudar con los de los demás.
// El admin solo supervisa.
export const DROPI_FIXER_IDS = [
  "cmrgq3z6n000004jwldrbjkqc", // BRYAN RIOS
  "cmrk1e8l60002b0vna4u0g8gs", // YAIR URGILEZ
];

export type DropiFixer = { id: string; name: string };

export async function getDropiFixTeam(): Promise<DropiFixer[]> {
  const users = await prisma.user.findMany({
    where: { isActive: true, OR: [{ id: { in: DROPI_FIXER_IDS } }, { canPublishMarketProduct: true }] },
    select: { id: true, name: true },
    orderBy: { id: "asc" },
  });
  return users;
}

export function dropiAssignee(code: string, team: DropiFixer[]): DropiFixer | null {
  if (!team.length) return null;
  let h = 0;
  for (const ch of code) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return team[h % team.length];
}

// Lo que hay que corregir (precio bajo y stock por subir) con su responsable.
export async function getDropiFixList(): Promise<{
  readAt: string;
  errors: string[];
  team: DropiFixer[];
  checks: (DropiCheck & { assignee: DropiFixer | null })[];
}> {
  const [data, team] = await Promise.all([getCachedDropiCatalogChecks(), getDropiFixTeam()]);
  return {
    readAt: data.readAt,
    errors: data.errors,
    team,
    checks: data.checks.map((c) => ({ ...c, assignee: c.kind === "revisar_stock" ? null : dropiAssignee(c.code, team) })),
  };
}
