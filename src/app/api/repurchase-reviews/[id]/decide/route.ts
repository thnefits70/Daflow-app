import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getRepurchaseAccess } from "@/lib/repurchaseAccess";
import { decideRepurchaseReview } from "@/lib/repurchaseReviews";

const schema = z.object({
  decision: z.enum(["APPROVE", "REJECT"]),
  approvedQuantity: z.number().int().positive().nullable().optional(),
  rejectReason: z.string().trim().max(1000).nullable().optional(),
});

// Aprobar o rechazar una recompra: exclusivo de Bryan (líder de Análisis de
// Mercado). Puede cambiar solo la cantidad, nunca el proveedor.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const access = await getRepurchaseAccess();
  if (!access?.canDecide) return NextResponse.json({ error: "Aprobar o rechazar recompras es de Bryan (líder de Análisis de Mercado)." }, { status: 403 });
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });
  const { id } = await params;
  const result = await decideRepurchaseReview({
    id,
    decision: parsed.data.decision,
    approvedQuantity: parsed.data.approvedQuantity ?? null,
    rejectReason: parsed.data.rejectReason ?? null,
    userId: access.userId,
    actorName: access.name,
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ ok: true });
}
