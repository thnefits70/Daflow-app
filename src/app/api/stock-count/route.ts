import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { canActOnMerchandiseOutflow, canCaptureMerchandiseOutflow, dbUserId } from "@/lib/guards";
import { fullCountCompleted, getActiveCount, getCountView, startFullCount, weeklyAreaFor } from "@/lib/stockCount";

// Conteo físico (pedido del usuario 2026-10-02): el equipo de Inventario
// cuenta a ciegas; Daniel inicia el conteo general y envía las diferencias.
export async function GET() {
  const session = await auth();
  const canCount = await canCaptureMerchandiseOutflow();
  const isLead = await canActOnMerchandiseOutflow();
  if (!session || (!canCount && !isLead)) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  const active = await getActiveCount(dbUserId(session.user.id));
  const [view, completed, week] = await Promise.all([active ? getCountView(active.id) : null, fullCountCompleted(), weeklyAreaFor()]);
  return NextResponse.json({ count: view, fullCompleted: completed, weeklyArea: week?.area ?? null, isLead });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session || !(await canActOnMerchandiseOutflow())) return NextResponse.json({ error: "Solo el líder de Inventarios inicia el conteo general." }, { status: 403 });
  const body = await req.json().catch(() => null);
  if (body?.action !== "start-full") return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });
  const count = await startFullCount(dbUserId(session.user.id));
  return NextResponse.json({ id: count.id });
}
