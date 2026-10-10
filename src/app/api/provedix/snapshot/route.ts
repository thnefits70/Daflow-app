import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { saveProvedixSnapshot } from "@/lib/provedixSnapshot";

export const maxDuration = 120;

// "Recalcular ahora" de la sección Provedix (solo admin): rehace el resumen
// por producto sin esperar al cron del mediodía.
export async function POST() {
  const session = await auth();
  if (!session || session.user.role !== "admin") {
    return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  }
  const data = await saveProvedixSnapshot();
  return NextResponse.json({ ok: true, products: data.products.length });
}
