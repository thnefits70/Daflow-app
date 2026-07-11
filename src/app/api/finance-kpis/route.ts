import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { requireAdminSession } from "@/lib/guards";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "No autorizado." }, { status: 401 });

  const deptId = req.nextUrl.searchParams.get("deptId");
  if (!deptId) return NextResponse.json({ error: "Falta deptId." }, { status: 400 });
  if (session.user.role === "employee" && session.user.deptId !== deptId) {
    return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  }

  const records = await prisma.financeKpiRecord.findMany({
    where: { deptId },
    orderBy: { period: "asc" },
  });
  return NextResponse.json(records);
}

const periodRegex = /^\d{4}-(0[1-9]|1[0-2])$/;

const createSchema = z.object({
  deptId: z.string().min(1),
  period: z.string().regex(periodRegex, "Formato de mes inválido."),
  roi: z.number().nullable().optional(),
  monthlySales: z.number().nullable().optional(),
  monthlyProfit: z.number().nullable().optional(),
  notes: z.string().optional(),
  fileUrl: z.string().nullable().optional(),
  fileName: z.string().nullable().optional(),
});

export async function POST(req: NextRequest) {
  const session = await requireAdminSession();
  if (!session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });
  }

  const { deptId, period, ...rest } = parsed.data;
  const record = await prisma.financeKpiRecord.upsert({
    where: { deptId_period: { deptId, period } },
    update: rest,
    create: { deptId, period, ...rest },
  });
  return NextResponse.json(record, { status: 201 });
}
