import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { canConfirmFulfillmentLot, dbUserId } from "@/lib/guards";
import { confirmBackfillLot } from "@/lib/fulfillmentPicking";

// Manifiesto atrasado (pedido del usuario 2026-09-29): Daniel confirma de
// una vez que salió todo — la doble confirmación es en pantalla.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!(await canConfirmFulfillmentLot()) || !session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  const { id } = await params;
  const result = await confirmBackfillLot({ lotId: id, userId: dbUserId(session.user.id) });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({ ok: true, discounted: result.discounted, skipped: result.skipped });
}
