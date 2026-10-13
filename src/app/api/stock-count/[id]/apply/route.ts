import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { canActOnMerchandiseOutflow } from "@/lib/guards";
import { applyCountedSoFar } from "@/lib/stockCount";

// Pedido del usuario 2026-10-13: Daniel aplica a INVESTOCK lo contado hasta
// ahora sin cerrar el conteo. Las diferencias pequeñas se aplican solas; las
// grandes pasan a recuento por otra persona.
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session || !(await canActOnMerchandiseOutflow())) return NextResponse.json({ error: "Solo el líder de Inventarios aplica el conteo." }, { status: 403 });
  const { id } = await params;
  const r = await applyCountedSoFar(id, session.user.name ?? "Daniel");
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 409 });
  return NextResponse.json(r.summary);
}
