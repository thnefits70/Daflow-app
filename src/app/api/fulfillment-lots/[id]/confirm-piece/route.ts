import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { canConfirmFulfillmentLot, dbUserId } from "@/lib/guards";
import { confirmWarrantyPiece } from "@/lib/fulfillmentPicking";

const schema = z.object({ itemId: z.string().min(1) });

// Garantía de solo una pieza (stock de repuestos): Daniel confirma que salió.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!(await canConfirmFulfillmentLot()) || !session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });
  const { id } = await params;
  const result = await confirmWarrantyPiece({ lotId: id, itemId: parsed.data.itemId, userId: dbUserId(session.user.id) });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({ ok: true });
}
