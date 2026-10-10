import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { canManageStoreFeedback } from "@/lib/guards";
import { getProvedixOverview } from "@/lib/provedixAdmin";

// Tiendas que más venden nuestros productos, con su celular — solo el admin
// y quien hace Servicio Postventa (Nairoby, canManageStoreFeedback). Pedido
// del usuario 2026-10-10: "Nairoby y yo podemos ver".
export async function GET() {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  if (session.user.role !== "admin" && !(await canManageStoreFeedback())) {
    return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  }
  const { windowFrom, stores } = await getProvedixOverview();
  return NextResponse.json({ windowFrom, stores });
}
