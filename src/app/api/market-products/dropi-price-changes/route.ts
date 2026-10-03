import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { canPublishMarketProduct } from "@/lib/guards";
import { confirmDropiPriceChange, getDropiPriceChanges } from "@/lib/dropiPriceChanges";

// Pedido del usuario 2026-10-02 — ver dropiPriceChanges.ts. Lista para quien
// publica en Dropi de los productos cuyo precio conviene cambiar.
export async function GET() {
  if (!(await canPublishMarketProduct())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  return NextResponse.json(await getDropiPriceChanges());
}

const schema = z.object({ catalogItemId: z.string().min(1), shownPrice: z.number().positive() });

// "Ya lo cambié en Dropi" — queda quién y cuándo.
export async function POST(req: NextRequest) {
  if (!(await canPublishMarketProduct())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  const session = await auth();
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });
  const r = await confirmDropiPriceChange(parsed.data.catalogItemId, parsed.data.shownPrice, session!.user.id);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 409 });
  return NextResponse.json(r);
}
