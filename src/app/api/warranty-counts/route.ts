import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { canManageWarranties } from "@/lib/guards";

export async function GET() {
  const canManage = await canManageWarranties();
  if (!canManage) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const counts = await prisma.warrantyCategoryMonthCount.findMany({
    orderBy: [{ month: "desc" }],
    include: { category: { select: { id: true, name: true } } },
  });
  return NextResponse.json(counts);
}

const upsertSchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/, "Mes inválido."),
  categoryId: z.string().min(1, "Falta la categoría."),
  count: z.number().int().min(0, "El conteo no puede ser negativo."),
});

export async function POST(req: NextRequest) {
  const canManage = await canManageWarranties();
  if (!canManage) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const body = await req.json().catch(() => null);
  const parsed = upsertSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });
  }
  const { month, categoryId, count } = parsed.data;

  const category = await prisma.warrantyCategory.findUnique({ where: { id: categoryId } });
  if (!category) return NextResponse.json({ error: "Categoría no encontrada." }, { status: 404 });

  const record = await prisma.warrantyCategoryMonthCount.upsert({
    where: { month_categoryId: { month, categoryId } },
    create: { month, categoryId, count },
    update: { count },
    include: { category: { select: { id: true, name: true } } },
  });
  return NextResponse.json(record, { status: 201 });
}
