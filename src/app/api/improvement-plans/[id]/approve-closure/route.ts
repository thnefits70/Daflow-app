import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminSession } from "@/lib/guards";
import { approveImprovementPlanClosure } from "@/lib/improvementPlan";

const approveSchema = z.object({
  approve: z.boolean(),
  rejectionNote: z.string().trim().optional(),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireAdminSession();
  if (!session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { id } = await params;
  const body = await req.json().catch(() => null);
  const parsed = approveSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });
  }

  try {
    const updated = await approveImprovementPlanClosure({
      planId: id,
      adminActorId: session.user.id,
      approve: parsed.data.approve,
      rejectionNote: parsed.data.rejectionNote,
    });
    return NextResponse.json(updated);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "No se pudo procesar la aprobación." }, { status: 400 });
  }
}
