import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { canActOnMerchandiseOutflow, dbUserId } from "@/lib/guards";
import { submitCount } from "@/lib/stockCount";

// Daniel revisa y envía. Desde 2026-10-13 lo contado se aplica solo a
// INVESTOCK (las diferencias grandes van a recuento) y el admin recibe un
// resumen — ya no aprueba una lista (ver submitCount).
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session || !(await canActOnMerchandiseOutflow())) return NextResponse.json({ error: "Solo el líder de Inventarios envía el conteo." }, { status: 403 });
  const { id } = await params;
  const r = await submitCount(id, dbUserId(session.user.id));
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 409 });
  return NextResponse.json(r);
}
