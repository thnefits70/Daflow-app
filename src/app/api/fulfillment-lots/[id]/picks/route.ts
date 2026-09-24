import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { canPickFulfillmentLot, dbUserId } from "@/lib/guards";
import { recordPick } from "@/lib/fulfillmentPicking";

const schema = z.object({ catalogItemId: z.string().min(1), quantity: z.number().int().min(0).max(100000) });

// Joel/Scott registran cuántos sacaron de la percha de un producto del corte.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!(await canPickFulfillmentLot()) || !session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });
  const { id } = await params;
  const result = await recordPick({ lotId: id, catalogItemId: parsed.data.catalogItemId, quantity: parsed.data.quantity, userId: dbUserId(session.user.id) });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({ ok: true });
}
