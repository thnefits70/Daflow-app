import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { canViewImprovementPlan, canActOnImprovementPlan } from "@/lib/guards";
import { getImprovementPlanDTO } from "@/lib/improvementPlan";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "No autorizado." }, { status: 401 });

  const { id } = await params;
  const plan = await getImprovementPlanDTO(id);
  if (!plan) return NextResponse.json({ error: "No encontrado." }, { status: 404 });

  if (!(await canViewImprovementPlan({ deptId: plan.deptId, collaboratorId: plan.collaboratorId }))) {
    return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  }

  const canAct = await canActOnImprovementPlan({ deptId: plan.deptId, leaderId: plan.leaderId });
  return NextResponse.json({ ...plan, canAct });
}
