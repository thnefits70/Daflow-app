import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAdminSession, canViewDeptReview } from "@/lib/guards";

export async function GET(req: NextRequest) {
  const deptId = req.nextUrl.searchParams.get("deptId");
  if (!deptId) return NextResponse.json({ error: "Falta deptId." }, { status: 400 });
  if (!(await canViewDeptReview(deptId))) {
    return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  }

  const records = await prisma.weeklyReviewRecord.findMany({
    where: { deptId },
    orderBy: { week: "asc" },
  });
  return NextResponse.json(records);
}

const weekRegex = /^\d{4}-W(0[1-9]|[1-4]\d|5[0-3])$/;

const createSchema = z.object({
  deptId: z.string().min(1),
  week: z.string().regex(weekRegex, "Formato de semana inválido."),
  problem: z.string().trim().min(1, "Describe el problema."),
  actionPlan: z.string().trim().min(1, "Describe el plan a ejecutar."),
  status: z.enum(["PENDING", "RESOLVED", "REJECTED"]).optional(),
});

export async function POST(req: NextRequest) {
  if (!(await requireAdminSession())) {
    return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });
  }

  const record = await prisma.weeklyReviewRecord.create({ data: parsed.data });
  return NextResponse.json(record, { status: 201 });
}
