import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { dbUserId } from "@/lib/guards";
import { canViewSuddenDemand } from "@/lib/suddenDemand";
import { getVariantSales } from "@/lib/variantSales";

// "Ventas por variante" (2026-10-05): mismo público que "Productos que
// despiertan" (Daniel, Jariel, Bryan Rios, la asesora B2B, Yair, Nairoby y
// el admin). Solo unidades, sin dinero.
const PERIODS = [7, 30, 90];

export async function GET(req: Request) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  const userId = dbUserId(session.user.id);
  if (session.user.role !== "admin" && !(userId && (await canViewSuddenDemand(userId)))) {
    return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  }
  const asked = Number(new URL(req.url).searchParams.get("days"));
  const days = PERIODS.includes(asked) ? asked : 30;
  const data = await getVariantSales({ days });
  // Un producto con una sola variante no dice nada de qué se vende más.
  return NextResponse.json({ days, ...data, products: data.products.filter((p) => p.variants.length >= 2) });
}
