import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { canConfirmFulfillmentLot, dbUserId } from "@/lib/guards";
import { confirmAllMatchingInCountedLots } from "@/lib/fulfillmentPicking";

// Pedido del usuario 2026-10-01: Daniel confirma de un clic todo lo que
// cuadra en los cortes ya contados (la doble confirmación es en pantalla).
export async function POST() {
  const session = await auth();
  if (!session || !(await canConfirmFulfillmentLot())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  const result = await confirmAllMatchingInCountedLots(dbUserId(session.user.id));
  return NextResponse.json(result);
}
