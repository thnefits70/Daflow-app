import { NextResponse, after } from "next/server";
import { auth } from "@/auth";
import { canConfirmFulfillmentLot, dbUserId } from "@/lib/guards";
import { confirmAllMatchingInCountedLots } from "@/lib/fulfillmentPicking";
import { notifyNewHotUrgents } from "@/lib/purchaseSuggestions";

// Pedido del usuario 2026-10-01: Daniel confirma de un clic todo lo que
// cuadra en los cortes ya contados (la doble confirmación es en pantalla).
export async function POST() {
  const session = await auth();
  if (!session || !(await canConfirmFulfillmentLot())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  const result = await confirmAllMatchingInCountedLots(dbUserId(session.user.id));
  // 2026-10-16: con el stock que bajó, aviso inmediato de compras calientes nuevas.
  after(() => notifyNewHotUrgents().then(() => undefined).catch(() => undefined));
  return NextResponse.json(result);
}
