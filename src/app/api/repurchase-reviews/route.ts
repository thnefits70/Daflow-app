import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getRepurchaseAccess } from "@/lib/repurchaseAccess";
import { createRepurchaseReview, listRepurchaseReviews } from "@/lib/repurchaseReviews";

// Recompras (pedido del usuario 2026-10-06). GET: lo que espera a Bryan y el
// historial (cada quien el suyo; Bryan y el admin, todo).
export async function GET() {
  const access = await getRepurchaseAccess();
  if (!access?.canView) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  const [pending, history] = await Promise.all([
    listRepurchaseReviews({ status: "PENDING_APPROVAL", requestedById: access.canViewAll ? undefined : access.userId, take: 100 }),
    listRepurchaseReviews({ requestedById: access.canViewAll ? undefined : access.userId, take: 80 }),
  ]);
  return NextResponse.json({
    pending,
    history: history.filter((r) => r.state !== "PENDING_APPROVAL"),
    canRequest: access.canRequest,
    canDecide: access.canDecide,
    canViewAll: access.canViewAll,
    userId: access.userId,
  });
}

const createSchema = z.object({
  catalogItemId: z.string().min(1),
  supplierId: z.string().min(1),
  unitCost: z.number().positive(),
  freightTotal: z.number().nonnegative().nullable(),
  quantity: z.number().int().positive(),
  competitorId: z.string().trim().max(60).nullable(),
  competitorPrice: z.number().positive().nullable(),
  noCompetitorNote: z.string().trim().max(500).nullable(),
  note: z.string().trim().max(1000).nullable(),
  // 2026-10-07: recompra caliente que confirma quien compra (ver hotSelfConfirmBlock).
  selfConfirm: z.boolean().optional(),
  checkedCompetitorToday: z.boolean().optional(),
});

export async function POST(req: NextRequest) {
  const access = await getRepurchaseAccess();
  if (!access?.canRequest) return NextResponse.json({ error: "Solo quien hace las compras envía recompras a Bryan." }, { status: 403 });
  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });
  const result = await createRepurchaseReview(parsed.data, access.userId, access.name);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ ok: true, code: result.code, selfConfirmed: result.selfConfirmed }, { status: 201 });
}
