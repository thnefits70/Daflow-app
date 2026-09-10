import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canManageImprovementPlan } from "@/lib/guards";
import { getDeptRosterWithImprovementPlanStatus } from "@/lib/improvementPlan";

// deptId por query param sirve tanto al líder viendo su propia "Mi área de
// trabajo" (omite el parámetro, se resuelve por su leadsDeptId) como al
// admin navegando el workspace de un departamento puntual (lo manda
// explícito) — canManageImprovementPlan valida ambos casos igual.
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "No autorizado." }, { status: 401 });

  let deptId = req.nextUrl.searchParams.get("deptId");
  if (!deptId) {
    const user = await prisma.user.findUnique({ where: { id: session.user.id }, select: { leadsDeptId: true } });
    deptId = user?.leadsDeptId ?? null;
  }
  if (!deptId) return NextResponse.json({ error: "Falta el departamento." }, { status: 400 });

  if (!(await canManageImprovementPlan(deptId))) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  return NextResponse.json(await getDeptRosterWithImprovementPlanStatus(deptId));
}
