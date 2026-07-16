import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { canManageReturnRate } from "@/lib/guards";

export async function GET() {
  const canManage = await canManageReturnRate();
  if (!canManage) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const records = await prisma.returnRateRecord.findMany({ orderBy: { month: "desc" } });
  return NextResponse.json(records);
}

const upsertSchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/, "Mes inválido."),
  value: z.number().min(0, "El porcentaje no puede ser negativo.").max(100, "El porcentaje no puede pasar de 100."),
});

export async function POST(req: NextRequest) {
  const canManage = await canManageReturnRate();
  if (!canManage) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const body = await req.json().catch(() => null);
  const parsed = upsertSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });
  }
  const { month, value } = parsed.data;

  const record = await prisma.returnRateRecord.upsert({
    where: { month },
    create: { month, value },
    update: { value },
  });
  return NextResponse.json(record, { status: 201 });
}
