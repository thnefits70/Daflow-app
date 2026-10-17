import { prisma } from "@/lib/prisma";
import { McpSession, toolText } from "@/lib/nick/dropiMcp";
import { getValidAccessToken } from "@/lib/nick/dropiOAuth";
import { getVariantStock } from "@/lib/variantStock";
import { getVariantSales } from "@/lib/variantSales";

// Stock real vs publicado en Dropi (pedido del usuario 2026-10-17): cuando un
// dropshipper le dice a Michelle IA que necesita más stock para vender, la
// asesora abre el caso y con un clic ve lo que hay de verdad (DAFLOW: Kardex
// y conteo por color) al lado de lo que Dropi muestra hoy (por la conexión
// de NICK), y ajusta Dropi. Sin montos: solo unidades.

const ACCOUNT_BY_BRAND: Record<string, string> = {
  MKT_DAMIAN: "nick_acc_importadora_damian",
  MKT_PROVEDIX: "nick_acc_provedix",
};

export type DropiPublished = { total: number; variations: { id: string; stock: number; label: string | null }[] } | null;

// La lista de productos de Dropi llega como texto con sangrías:
//   - id: 169468 ... stock: 0 ... variations[3]: - id: 65997 / stock: 6 / attributes[...]
export function parseProductStock(text: string, code: string): DropiPublished {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((l) => new RegExp(`^\\s*-\\s*id:\\s*${code}\\s*$`).test(l));
  if (start < 0) return null;
  const indent = lines[start].search(/-/);
  let total: number | null = null;
  const variations: { id: string; stock: number; label: string | null }[] = [];
  let inVariations = false;
  let current: { id: string; stock: number; label: string | null } | null = null;
  for (let i = start + 1; i < lines.length; i++) {
    const l = lines[i];
    const ind = l.search(/\S/);
    if (ind >= 0 && ind <= indent && /^\s*-\s/.test(l)) break; // siguiente producto
    if (ind >= 0 && ind < indent) break;
    if (/^\s*variations\[/.test(l)) {
      inVariations = true;
      continue;
    }
    if (inVariations) {
      const id = l.match(/^\s*-\s*id:\s*(\d+)/);
      if (id) {
        current = { id: id[1], stock: 0, label: null };
        variations.push(current);
        continue;
      }
      const st = l.match(/^\s*stock:\s*(-?\d+)/);
      if (st && current) current.stock = Number(st[1]);
      // Si algún día Dropi manda el nombre del color en attributes, se muestra.
      const val = l.match(/^\s*(?:value|name|valor):\s*"?([^"\n]+)"?\s*$/i);
      if (val && current && !current.label) current.label = val[1].trim();
    } else {
      const st = l.match(/^\s*stock:\s*(-?\d+)/);
      if (st && total == null) total = Number(st[1]);
    }
  }
  const sum = variations.reduce((s, v) => s + Math.max(0, v.stock), 0);
  return { total: variations.length ? sum : Math.max(0, total ?? 0), variations };
}

async function dropiPublished(code: string, brand: string): Promise<DropiPublished | "sin_conexion"> {
  const accountId = ACCOUNT_BY_BRAND[brand];
  if (!accountId) return "sin_conexion";
  try {
    const mcp = new McpSession(accountId, await getValidAccessToken(accountId));
    await mcp.init();
    const r = await mcp.callTool("list_products", { search: code, get_stock: true });
    return parseProductStock(toolText(r), code);
  } catch {
    return "sin_conexion";
  }
}

export type StockCheck = {
  code: string;
  name: string;
  brand: string;
  asked: string | null;
  realTotal: number;
  realByVariant: { name: string; stock: number }[];
  unidentified: number;
  dropi: DropiPublished | "sin_conexion";
  sold30: number;
  coverageDays: number | null;
  dropiUrl: string;
};

// El resumen del caso empieza con "STOCK · ID 169468 · Azul · lo que necesita".
export function parseStockSummary(summary: string): { code: string; asked: string | null } | null {
  const m = summary.match(/^STOCK · ID (\d{3,8})(?: · ([^·]{1,60}))?(?: · |$)/);
  if (!m) return null;
  const parts = summary.split(" · ");
  return { code: m[1], asked: parts.length >= 4 ? parts[2].trim() : null };
}

export async function stockCheckForCase(caseId: string): Promise<StockCheck | { error: string }> {
  const c = await prisma.provedixCase.findUnique({ where: { id: caseId }, select: { summary: true } });
  const parsed = c ? parseStockSummary(c.summary) : null;
  if (!parsed) return { error: "Este caso no es de stock." };
  const item = await prisma.purchaseCatalogItem.findFirst({
    where: { justCode: parsed.code, bodega: { in: ["MKT_PROVEDIX", "MKT_DAMIAN"] } },
    select: { id: true, name: true, bodega: true },
  });
  if (!item) return { error: `No encontré el ID ${parsed.code} en el catálogo.` };
  const [kardex, variants, sales, dropi] = await Promise.all([
    prisma.stockKardexEntry.findFirst({
      where: { catalogItemId: item.id },
      orderBy: [{ occurredAt: "desc" }, { createdAt: "desc" }],
      select: { balanceAfter: true },
    }),
    getVariantStock([item.id]),
    getVariantSales({ days: 30, catalogItemIds: [item.id] }),
    dropiPublished(parsed.code, item.bodega ?? ""),
  ]);
  const v = variants.get(item.id);
  const sold30 = sales.products[0]?.totalUnits ?? 0;
  const realTotal = Math.max(0, kardex?.balanceAfter ?? 0);
  return {
    code: parsed.code,
    name: item.name,
    brand: item.bodega === "MKT_DAMIAN" ? "Importadora Damián" : "Provedix",
    asked: parsed.asked,
    realTotal,
    realByVariant: (v?.variants ?? []).map((x) => ({ name: x.name, stock: x.stock })),
    unidentified: Math.max(0, v?.unidentified ?? 0),
    dropi,
    sold30,
    coverageDays: sold30 > 0 ? Math.floor(realTotal / (sold30 / 30)) : null,
    dropiUrl: `https://app.dropi.ec/dashboard/search?search=${parsed.code}&search_type=semantic`,
  };
}
