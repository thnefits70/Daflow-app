import { NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { auth } from "@/auth";
import { canPublishMarketProduct } from "@/lib/guards";
import { DROPI_CATALOG_TAG, DROPI_FIXER_IDS, getDropiFixList } from "@/lib/dropiCatalogCheck";

// Stock y precio en Dropi vs INVESTOCK (2026-10-17, ver dropiCatalogCheck.ts).
// Corrigen Michelle (asesora B2B), Bryan Ríos y Yair; el admin solo supervisa.
async function access(): Promise<{ role: "team"; userId: string } | { role: "admin" } | null> {
  const session = await auth();
  if (!session) return null;
  if (session.user.role === "admin") return { role: "admin" };
  if (DROPI_FIXER_IDS.includes(session.user.id) || (await canPublishMarketProduct())) return { role: "team", userId: session.user.id };
  return null;
}

export async function GET() {
  const who = await access();
  if (!who) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  const data = await getDropiFixList();
  return NextResponse.json({ ...data, viewer: who.role === "admin" ? { role: "admin" } : { role: "team", userId: who.userId } });
}

// "Ya actualicé Dropi": vuelve a leer el catálogo al instante (solo quien corrige).
export async function POST() {
  const who = await access();
  if (!who || who.role !== "team") return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  revalidateTag(DROPI_CATALOG_TAG, { expire: 0 });
  return NextResponse.json({ ok: true });
}
