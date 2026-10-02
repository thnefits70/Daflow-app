import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { canConfirmFulfillmentLot, dbUserId } from "@/lib/guards";
import { confirmUnscannedAsShipped } from "@/lib/fulfillmentPicking";

// Daniel da por despachado lo que nadie escaneó en un corte de un día
// anterior (la doble confirmación es en pantalla) — ver confirmUnscannedAsShipped.
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!(await canConfirmFulfillmentLot()) || !session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  const { id } = await params;
  const result = await confirmUnscannedAsShipped({ lotId: id, userId: dbUserId(session.user.id) });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({ ok: true, confirmed: result.confirmed });
}
