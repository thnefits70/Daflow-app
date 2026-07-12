import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { canEditDeptKpis } from "@/lib/guards";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "No autorizado." }, { status: 401 });

  const deptId = req.nextUrl.searchParams.get("deptId");
  if (!deptId) return NextResponse.json({ error: "Falta deptId." }, { status: 400 });

  const records = await prisma.weeklyMetricRecord.findMany({
    where: { deptId },
    orderBy: { week: "asc" },
  });
  return NextResponse.json(records);
}

const weekRegex = /^\d{4}-W(0[1-9]|[1-4]\d|5[0-3])$/;

const createSchema = z.object({
  deptId: z.string().min(1),
  week: z.string().regex(weekRegex, "Formato de semana inválido."),
  value: z.number().int().min(0),
});

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });
  }

  const { deptId, week, value } = parsed.data;
  if (!(await canEditDeptKpis(deptId))) {
    return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  }

  const record = await prisma.weeklyMetricRecord.upsert({
    where: { deptId_week: { deptId, week } },
    update: { value },
    create: { deptId, week, value },
  });
  return NextResponse.json(record, { status: 201 });
}
