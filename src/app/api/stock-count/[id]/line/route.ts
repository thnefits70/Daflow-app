import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { canActOnMerchandiseOutflow, canCaptureMerchandiseOutflow, dbUserId } from "@/lib/guards";
import { recordCount } from "@/lib/stockCount";

const schema = z.object({ catalogItemId: z.string().min(1), quantity: z.number().int().min(0) });

// Registra (o corrige) cuánto hay de un producto — a ciegas.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  const isLead = !!session && (await canActOnMerchandiseOutflow());
  if (!session || !(isLead || (await canCaptureMerchandiseOutflow()))) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Escribe una cantidad entera, 0 o mayor." }, { status: 400 });
  const { id } = await params;
  const r = await recordCount({ countId: id, catalogItemId: parsed.data.catalogItemId, quantity: parsed.data.quantity, userId: dbUserId(session.user.id), isLead });
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 409 });
  return NextResponse.json({ ok: true });
}
