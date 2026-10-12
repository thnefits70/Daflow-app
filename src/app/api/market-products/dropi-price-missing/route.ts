import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { canPublishMarketProduct } from "@/lib/guards";
import { getMissingDropiPrices, saveMissingDropiPrice } from "@/lib/dropiPriceMissing";

// Pedido del usuario 2026-10-12 — ver lib/dropiPriceMissing.ts. Quien publica
// en Dropi (asesora B2B) escribe el precio PUBLICADO en Dropi de los
// productos de provedix.com que todavía no lo tienen.
export async function GET() {
  if (!(await canPublishMarketProduct())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  return NextResponse.json(await getMissingDropiPrices());
}

const schema = z.object({ catalogItemId: z.string().min(1), price: z.number() });

export async function POST(req: NextRequest) {
  if (!(await canPublishMarketProduct())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  const session = await auth();
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });
  const r = await saveMissingDropiPrice(parsed.data.catalogItemId, parsed.data.price, session!.user.id);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 409 });
  return NextResponse.json(r);
}
