import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canEditDeptKpis } from "@/lib/guards";

const bodySchema = z.object({
  justification: z.string().trim().min(10).max(2000),
});

// Confirmado 2026-08-31: la explicación del Fill Rate bajo la escribe quien
// puede editar los KPI de ese departamento (admin o el líder de
// Fulfillment — mismo guard que /api/weekly-metrics/[id]). Se guarda el
// nombre de quien la firma para mostrarlo tal cual en la tarjeta pública.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const existing = await prisma.weeklyMetricRecord.findUnique({ where: { id }, select: { deptId: true } });
  if (!existing) return NextResponse.json({ error: "No encontrado." }, { status: 404 });
  if (!(await canEditDeptKpis(existing.deptId))) {
    return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  }

  const session = await auth();
  const body = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });
  }

  const record = await prisma.weeklyMetricRecord.update({
    where: { id },
    data: {
      fillRateJustification: parsed.data.justification,
      fillRateJustificationBy: session?.user.name ?? null,
      fillRateJustificationAt: new Date(),
    },
  });
  return NextResponse.json(record);
}
