import { NextResponse } from "next/server";
import { getRepurchaseAccess } from "@/lib/repurchaseAccess";
import { suspendApprovedRepurchase } from "@/lib/repurchaseReviews";

// Suspende una recompra aprobada que todavía no se pidió (ej. el conteo
// físico encontró más stock). Quien la envió o Bryan.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = await getRepurchaseAccess();
  if (!access || !(access.canRequest || access.canDecide)) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const result = await suspendApprovedRepurchase({
    id,
    userId: access.userId,
    canDecide: access.canDecide,
    reason: typeof body?.reason === "string" ? body.reason : "",
    actorName: access.name,
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ ok: true });
}
