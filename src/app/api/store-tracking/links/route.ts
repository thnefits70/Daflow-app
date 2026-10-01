import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { canLinkStoreProducts, dbUserId } from "@/lib/guards";
import { linkStoreProduct } from "@/lib/storeTracking";

const schema = z.object({
  codes: z.array(z.string().trim().min(1).max(40)).min(1).max(200),
  storeId: z.string().min(1),
});

// Vincular IDs de Importadora Shanghai a su tienda — exclusivo de Yair
// (canLinkStoreProducts). Pedido del usuario 2026-10-01.
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session || !(await canLinkStoreProducts())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });
  for (const code of new Set(parsed.data.codes)) {
    const r = await linkStoreProduct({ code, storeId: parsed.data.storeId, userId: dbUserId(session.user.id) });
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
