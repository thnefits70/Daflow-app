import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { canReviewMarketProduct } from "@/lib/guards";
import { cancelMarketProposal } from "@/lib/marketProposalCancel";

const schema = z.object({ reason: z.string().trim().min(1, "Falta el motivo.") });

// Pedido del usuario 2026-10-03 (AM-0018): botón "Cancelar propuesta" en
// Trazabilidad — reglas en src/lib/marketProposalCancel.ts. Rechazar una
// compra no cierra la propuesta sola; al rechazar, Bryan puede marcarlo ahí
// mismo (ver purchase-requests/group/[groupId]/review).
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session || !(await canReviewMarketProduct())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { id } = await params;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });

  const result = await cancelMarketProposal({ proposalId: id, reason: parsed.data.reason, actorUserId: session.user.role === "admin" ? null : session.user.id });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ ok: true });
}
