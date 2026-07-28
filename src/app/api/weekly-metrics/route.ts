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
  prepared: z.number().int().min(0).nullable().optional(),
  generated: z.number().int().min(0).nullable().optional(),
  outOfStock: z.number().int().min(0).nullable().optional(),
});

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });
  }

  const { deptId, week, value, prepared, generated, outOfStock } = parsed.data;
  if (!(await canEditDeptKpis(deptId))) {
    return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  }

  // Confirmado 2026-07-28: notDispatched pasa a ser la suma de las 3
  // categorías nuevas (preparadas + generadas + falta de stock), ya no un
  // campo suelto — se sigue guardando para que el Fill Rate histórico
  // (semanas ya cargadas antes de este cambio) siga funcionando igual.
  const hasBreakdown = prepared != null || generated != null || outOfStock != null;
  const notDispatched = hasBreakdown ? (prepared ?? 0) + (generated ?? 0) + (outOfStock ?? 0) : null;

  const record = await prisma.weeklyMetricRecord.upsert({
    where: { deptId_week: { deptId, week } },
    update: { value, prepared, generated, outOfStock, notDispatched },
    create: { deptId, week, value, prepared, generated, outOfStock, notDispatched },
  });
  return NextResponse.json(record, { status: 201 });
}
