import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canManageJustCatalog } from "@/lib/guards";

const CATALOG_ITEM_SELECT = { id: true, name: true, photos: true, justCode: true } as const;

// Confirmado 2026-08-26 (pedido explícito del usuario): un ID de combo de
// Dropi NO es un producto físico real — Dropi los crea con nombres
// distintos por tema publicitario, pero por dentro empaquetan varios
// productos reales de Just en cantidades fijas. Daniel registra acá cómo
// se desglosa cada combo (tribal knowledge real, no viene en el export de
// Just) para que Registro de Egresos lo aplique solo cada vez que ese
// código aparece en una hoja de despacho/garantía. Mismo gate que subir el
// export de Just (canManageJustCatalog: Daniel o admin) — visibilidad
// exclusiva, no se comparte con el resto de "Base de datos de productos".
export async function GET() {
  if (!(await canManageJustCatalog())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const combos = await prisma.dropiCombo.findMany({
    orderBy: { createdAt: "desc" },
    include: { createdBy: { select: { name: true } }, components: { include: { catalogItem: { select: CATALOG_ITEM_SELECT } } } },
  });
  return NextResponse.json(
    combos.map((c) => ({
      id: c.id,
      code: c.code,
      label: c.label,
      createdByName: c.createdBy?.name ?? null,
      createdAt: c.createdAt,
      components: c.components.map((comp) => ({ id: comp.id, quantity: comp.quantity, catalogItem: comp.catalogItem })),
    }))
  );
}

const componentSchema = z.object({ catalogItemId: z.string().min(1), quantity: z.number().int().positive() });
const createSchema = z.object({ code: z.string().trim().min(1), label: z.string().trim().optional(), components: z.array(componentSchema).min(1) });

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!(await canManageJustCatalog()) || !session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });

  // Confirmado 2026-08-26 (pedido explícito del usuario): si el código ya
  // existe, se ACTUALIZA en vez de rechazar — Daniel puede darse cuenta a
  // mitad de una lectura que un combo ya registrado tiene la receta
  // equivocada (ver "Corregir este combo" en DocumentCaptureFlow) y esto
  // deja corregirlo sin tener que ir a buscarlo aparte en Base de datos de
  // productos.
  const existing = await prisma.dropiCombo.findUnique({ where: { code: parsed.data.code } });
  const combo = existing
    ? await prisma.$transaction(async (tx) => {
        await tx.dropiComboComponent.deleteMany({ where: { comboId: existing.id } });
        return tx.dropiCombo.update({
          where: { id: existing.id },
          data: {
            label: parsed.data.label || existing.label,
            components: { create: parsed.data.components.map((c) => ({ catalogItemId: c.catalogItemId, quantity: c.quantity })) },
          },
          include: { components: { include: { catalogItem: { select: CATALOG_ITEM_SELECT } } } },
        });
      })
    : await prisma.dropiCombo.create({
        data: {
          code: parsed.data.code,
          label: parsed.data.label || null,
          createdById: session.user.id,
          components: { create: parsed.data.components.map((c) => ({ catalogItemId: c.catalogItemId, quantity: c.quantity })) },
        },
        include: { components: { include: { catalogItem: { select: CATALOG_ITEM_SELECT } } } },
      });
  return NextResponse.json(combo);
}
