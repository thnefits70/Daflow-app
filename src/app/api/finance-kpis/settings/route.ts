import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { canEditDeptKpis } from "@/lib/guards";

const settingsSchema = z.object({
  deptId: z.string().min(1),
  targetMargenBruto: z.number().min(0).max(100).optional(),
  targetMargenOperativo: z.number().min(0).max(100).optional(),
  targetMargenNeto: z.number().min(0).max(100).optional(),
  excelenteMargenNeto: z.number().min(0).max(100).optional(),
  roiBandRed: z.number().min(0).max(100).optional(),
  roiBandYellow: z.number().min(0).max(100).optional(),
  roiBandTarget: z.number().min(0).max(100).optional(),
  taxRatePct: z.number().min(0).max(100).optional(),
});

export async function PATCH(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const parsed = settingsSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });
  }
  const { deptId, ...rest } = parsed.data;

  if (!(await canEditDeptKpis(deptId))) {
    return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  }

  const settings = await prisma.financeKpiSettings.upsert({
    where: { deptId },
    update: rest,
    create: { deptId, ...rest },
  });
  return NextResponse.json(settings);
}
