import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { canManageCommissionTiers } from "@/lib/guards";

const schema = z.object({
  name: z.string().trim().min(1).optional(),
  minDailyAvg: z.number().nonnegative().optional(),
  maxDailyAvg: z.number().nonnegative().nullable().optional(),
});

// Confirmado 2026-08-14: cambiar los rangos/nombres de los 3 niveles es
// estructural — exclusivo del admin, ni siquiera Nairoby.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await canManageCommissionTiers())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { id } = await params;
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });

  const tier = await prisma.commissionTier.update({ where: { id }, data: parsed.data });
  return NextResponse.json(tier);
}
