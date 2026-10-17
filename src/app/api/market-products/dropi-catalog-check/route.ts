import { NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { auth } from "@/auth";
import { canPublishMarketProduct } from "@/lib/guards";
import { PROVISIONAL_DROPI_PRICE_HELPERS } from "@/lib/dropiPriceMissing";
import { DROPI_CATALOG_TAG, getCachedDropiCatalogChecks } from "@/lib/dropiCatalogCheck";

// Stock y precio en Dropi vs INVESTOCK (2026-10-17, ver dropiCatalogCheck.ts).
// La asesora B2B ve todo; Yair solo los precios por debajo del mínimo (ayuda a
// corregirlos); el admin ve todo.
async function access(): Promise<"all" | "price" | null> {
  const session = await auth();
  if (!session) return null;
  if (session.user.role === "admin" || (await canPublishMarketProduct())) return "all";
  return PROVISIONAL_DROPI_PRICE_HELPERS.has(session.user.id) ? "price" : null;
}

export async function GET() {
  const who = await access();
  if (!who) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  const data = await getCachedDropiCatalogChecks();
  return NextResponse.json(who === "all" ? data : { ...data, checks: data.checks.filter((c) => c.kind === "precio_bajo") });
}

// "Ya actualicé Dropi": vuelve a leer el catálogo al instante.
export async function POST() {
  if (!(await access())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  revalidateTag(DROPI_CATALOG_TAG, { expire: 0 });
  return NextResponse.json({ ok: true });
}
