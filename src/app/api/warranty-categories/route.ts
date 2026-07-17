import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { canManageWarranties } from "@/lib/guards";

export async function GET() {
  const canManage = await canManageWarranties();
  if (!canManage) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const categories = await prisma.warrantyCategory.findMany({ orderBy: { name: "asc" } });
  return NextResponse.json(categories);
}

const createSchema = z.object({
  name: z.string().trim().min(1, "Falta el nombre de la categoría."),
});

export async function POST(req: NextRequest) {
  const canManage = await canManageWarranties();
  if (!canManage) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });
  }

  const category = await prisma.warrantyCategory
    .create({ data: { name: parsed.data.name } })
    .catch(() => null);
  if (!category) return NextResponse.json({ error: "Ya existe una categoría con ese nombre." }, { status: 409 });

  return NextResponse.json(category, { status: 201 });
}
