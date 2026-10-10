import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { comboCodeUsedByProduct } from "@/lib/comboBrand";
import { aliasEditMessage, syncComboAliases } from "@/lib/comboAlias";
import { componentsMissingDropiId, missingDropiIdMessage } from "@/lib/fulfillmentGuides";
import { auth } from "@/auth";

const CATALOG_ITEM_SELECT = { id: true, name: true, photos: true, justCode: true } as const;

const componentSchema = z.object({ catalogItemId: z.string().min(1), quantity: z.number().int().positive() });
const updateSchema = z.object({ code: z.string().trim().min(1), label: z.string().trim().optional(), components: z.array(componentSchema).min(1) });

// Pedido del usuario 2026-10-10: la receta se registra una sola vez (con
// doble confirmación); corregirla o borrar el combo es solo del admin.
const ADMIN_ONLY = "Solo el administrador puede cambiar o borrar un combo ya registrado — avísale.";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if ((await auth())?.user.role !== "admin") return NextResponse.json({ error: ADMIN_ONLY }, { status: 403 });

  const { id } = await params;
  const body = await req.json().catch(() => null);
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });

  // Regla del usuario 2026-09-23: un combo solo lleva productos con su ID
  // real de Dropi — ver componentsMissingDropiId.
  const missingIds = await componentsMissingDropiId(parsed.data.components.map((c) => c.catalogItemId));
  if (missingIds.length > 0) return NextResponse.json({ error: missingDropiIdMessage(missingIds) }, { status: 400 });

  const existing = await prisma.dropiCombo.findUnique({ where: { id }, include: { aliasOf: { select: { code: true } } } });
  if (!existing) return NextResponse.json({ error: "No encontrado." }, { status: 404 });
  // Pedido del usuario 2026-10-10: un ID alterno no tiene receta propia.
  if (existing.aliasOf) return NextResponse.json({ error: aliasEditMessage(existing.code, existing.aliasOf.code) }, { status: 400 });

  const codeTaken = await prisma.dropiCombo.findFirst({ where: { code: parsed.data.code, id: { not: id } } });
  if (codeTaken) return NextResponse.json({ error: "Ya existe otro combo con ese código." }, { status: 409 });
  const clash = await comboCodeUsedByProduct(parsed.data.code);
  if (clash) return NextResponse.json({ error: clash }, { status: 409 });

  const combo = await prisma.$transaction(async (tx) => {
    await tx.dropiComboComponent.deleteMany({ where: { comboId: id } });
    const updated = await tx.dropiCombo.update({
      where: { id },
      data: {
        code: parsed.data.code,
        label: parsed.data.label || null,
        components: { create: parsed.data.components.map((c) => ({ catalogItemId: c.catalogItemId, quantity: c.quantity })) },
      },
      include: { components: { include: { catalogItem: { select: CATALOG_ITEM_SELECT } } } },
    });
    await syncComboAliases(tx, id);
    return updated;
  });
  return NextResponse.json(combo);
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if ((await auth())?.user.role !== "admin") return NextResponse.json({ error: ADMIN_ONLY }, { status: 403 });

  const { id } = await params;
  const existing = await prisma.dropiCombo.findUnique({ where: { id }, include: { aliases: { select: { code: true } } } });
  if (!existing) return NextResponse.json({ error: "No encontrado." }, { status: 404 });
  if (existing.aliases.length > 0) {
    return NextResponse.json({ error: `El combo ${existing.code} es el madre de ${existing.aliases.map((a) => a.code).join(", ")} — no se puede eliminar.` }, { status: 400 });
  }

  await prisma.dropiCombo.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
