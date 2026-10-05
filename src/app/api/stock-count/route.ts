import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { canActOnMerchandiseOutflow, canCaptureMerchandiseOutflow, dbUserId } from "@/lib/guards";
import { fullCountCompleted, getActiveCount, getCountView, startFullCount, weeklyAreaFor } from "@/lib/stockCount";
import { getAssignmentBoard, notifyLateAssignments } from "@/lib/stockCountAssignments";

// Conteo físico (pedido del usuario 2026-10-02): el equipo de Inventario
// cuenta a ciegas; Daniel inicia el conteo general, asigna cada área a una
// persona (2026-10-05) y envía las diferencias.
export async function GET() {
  const session = await auth();
  const canCount = await canCaptureMerchandiseOutflow();
  const isLead = await canActOnMerchandiseOutflow();
  if (!session || (!canCount && !isLead)) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  const userId = dbUserId(session.user.id);
  await notifyLateAssignments().catch(() => null);
  const active = await getActiveCount(userId);
  const [view, completed, week, board] = await Promise.all([
    active ? getCountView(active.id) : null,
    fullCountCompleted(),
    weeklyAreaFor(),
    active ? getAssignmentBoard(active, userId, isLead) : null,
  ]);
  let count = view;
  if (view && !isLead) {
    // Quien cuenta solo ve los productos de su área asignada, y en un
    // recuento nunca ve lo que contó la otra persona (a ciegas).
    const mine = new Set(board?.mine?.productIds ?? []);
    const recounting = board?.mine?.area === "RECOUNT";
    count = { ...view, products: view.products.filter((p) => mine.has(p.id)).map((p) => (recounting && p.recount ? { ...p, countedQty: null, countedByName: null, countedAt: null } : p)) };
  }
  return NextResponse.json({ count, fullCompleted: completed, weeklyArea: week?.area ?? null, isLead, board });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session || !(await canActOnMerchandiseOutflow())) return NextResponse.json({ error: "Solo el líder de Inventarios inicia el conteo general." }, { status: 403 });
  const body = await req.json().catch(() => null);
  if (body?.action !== "start-full") return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });
  const count = await startFullCount(dbUserId(session.user.id));
  return NextResponse.json({ id: count.id });
}
