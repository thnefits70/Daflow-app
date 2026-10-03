import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { canConfirmFulfillmentLot, dbUserId } from "@/lib/guards";
import { rereadLotVariants } from "@/lib/fulfillmentGuides";

// Leer ~280 páginas por PDF; un corte puede traer varios.
export const maxDuration = 300;

// Pedido del usuario 2026-10-03: Daniel relee los PDF guardados del corte
// para recuperar variantes que el lector no entendía — ver rereadLotVariants.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session || !(await canConfirmFulfillmentLot())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  const { id } = await params;
  const result = await rereadLotVariants(id, dbUserId(session.user.id));
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json(result);
}
