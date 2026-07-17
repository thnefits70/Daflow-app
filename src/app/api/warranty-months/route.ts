import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { canManageWarranties } from "@/lib/guards";

export async function GET() {
  const canManage = await canManageWarranties();
  if (!canManage) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const months = await prisma.warrantyMonthTotal.findMany({ orderBy: { month: "desc" } });
  return NextResponse.json(months);
}

const upsertSchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/, "Mes inválido."),
  total: z.number().int().min(0, "El total no puede ser negativo."),
});

export async function POST(req: NextRequest) {
  const canManage = await canManageWarranties();
  if (!canManage) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const body = await req.json().catch(() => null);
  const parsed = upsertSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });
  }
  const { month, total } = parsed.data;

  const record = await prisma.warrantyMonthTotal.upsert({
    where: { month },
    create: { month, total },
    update: { total },
  });
  return NextResponse.json(record, { status: 201 });
}
