import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { canManageJustCatalog } from "@/lib/guards";

const CATALOG_ITEM_SELECT = { id: true, name: true, photos: true, justCode: true } as const;

const componentSchema = z.object({ catalogItemId: z.string().min(1), quantity: z.number().int().positive() });
const updateSchema = z.object({ code: z.string().trim().min(1), label: z.string().trim().optional(), components: z.array(componentSchema).min(1) });

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await canManageJustCatalog())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { id } = await params;
  const body = await req.json().catch(() => null);
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });

  const existing = await prisma.dropiCombo.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "No encontrado." }, { status: 404 });

  const codeTaken = await prisma.dropiCombo.findFirst({ where: { code: parsed.data.code, id: { not: id } } });
  if (codeTaken) return NextResponse.json({ error: "Ya existe otro combo con ese código." }, { status: 409 });

  const combo = await prisma.$transaction(async (tx) => {
    await tx.dropiComboComponent.deleteMany({ where: { comboId: id } });
    return tx.dropiCombo.update({
      where: { id },
      data: {
        code: parsed.data.code,
        label: parsed.data.label || null,
        components: { create: parsed.data.components.map((c) => ({ catalogItemId: c.catalogItemId, quantity: c.quantity })) },
      },
      include: { components: { include: { catalogItem: { select: CATALOG_ITEM_SELECT } } } },
    });
  });
  return NextResponse.json(combo);
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await canManageJustCatalog())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { id } = await params;
  const existing = await prisma.dropiCombo.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "No encontrado." }, { status: 404 });

  await prisma.dropiCombo.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
