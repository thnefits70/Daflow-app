import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { dbUserId, fulfillmentPickScope } from "@/lib/guards";
import { recordPick } from "@/lib/fulfillmentPicking";

// variants (2026-10-06): color/talla de lo que salió "Sin variante" en las guías.
const schema = z.object({
  catalogItemId: z.string().min(1),
  quantity: z.number().int().min(0).max(100000),
  variants: z.array(z.object({ name: z.string().max(60), qty: z.number().int().min(0) })).max(40).optional(),
});

// Joel/Scott registran cuántos sacaron de la percha de un producto del corte.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  const scope = await fulfillmentPickScope();
  if (!scope || !session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });
  const { id } = await params;
  const result = await recordPick({ lotId: id, catalogItemId: parsed.data.catalogItemId, quantity: parsed.data.quantity, variants: parsed.data.variants, userId: dbUserId(session.user.id), onlyAssigned: scope === "ASSIGNED" });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({ ok: true });
}
