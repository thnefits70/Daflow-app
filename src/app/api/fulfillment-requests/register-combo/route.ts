import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { componentsMissingDropiId, missingDropiIdMessage } from "@/lib/fulfillmentGuides";
import { canSubmitFulfillmentRequest, canManageJustCatalog, dbUserId } from "@/lib/guards";

const CATALOG_ITEM_SELECT = { id: true, name: true, photos: true, justCode: true } as const;
const componentSchema = z.object({ catalogItemId: z.string().min(1), quantity: z.number().int().positive() });
const schema = z.object({ code: z.string().trim().min(1), label: z.string().trim().optional(), components: z.array(componentSchema).min(1) });

// Confirmado 2026-09-21, pedido explícito del usuario: Yair (Fulfillment)
// conoce de primera mano qué productos reales trae un combo (antes lo
// anotaba a mano en el papel) — puede registrar la receta él mismo desde
// "Solicitud Fulfillment", sin pasar por Daniel. A propósito MÁS ACOTADO
// que /api/dropi-combos (que sí puede sobrescribir cualquier combo): esta
// ruta solo crea un combo nuevo o COMPLETA uno que ya existe pero está
// vacío (0 componentes) — nunca sobrescribe una receta que Daniel ya
// registró con productos reales, para no arriesgar el dato compartido que
// también usa el despacho real (Kardex de INVESTOCK).
export async function POST(req: NextRequest) {
  const session = await auth();
  const allowed = (await canSubmitFulfillmentRequest()) || (await canManageJustCatalog());
  if (!allowed || !session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });

  // Regla del usuario 2026-09-23: un combo solo lleva productos con su ID
  // real de Dropi — ver componentsMissingDropiId.
  const missingIds = await componentsMissingDropiId(parsed.data.components.map((c) => c.catalogItemId));
  if (missingIds.length > 0) return NextResponse.json({ error: missingDropiIdMessage(missingIds) }, { status: 400 });

  const existing = await prisma.dropiCombo.findUnique({ where: { code: parsed.data.code }, include: { components: true } });
  if (existing && existing.components.length > 0) {
    return NextResponse.json({ error: "Este combo ya tiene una receta registrada — si crees que está mal, pídele a Daniel que la corrija en Base de datos de productos." }, { status: 400 });
  }

  const combo = existing
    ? await prisma.dropiCombo.update({
        where: { id: existing.id },
        data: { label: parsed.data.label || existing.label, components: { create: parsed.data.components.map((c) => ({ catalogItemId: c.catalogItemId, quantity: c.quantity })) } },
        include: { components: { include: { catalogItem: { select: CATALOG_ITEM_SELECT } } } },
      })
    : await prisma.dropiCombo.create({
        data: {
          code: parsed.data.code,
          label: parsed.data.label || null,
          createdById: dbUserId(session.user.id),
          components: { create: parsed.data.components.map((c) => ({ catalogItemId: c.catalogItemId, quantity: c.quantity })) },
        },
        include: { components: { include: { catalogItem: { select: CATALOG_ITEM_SELECT } } } },
      });

  return NextResponse.json({ id: combo.id, code: combo.code, label: combo.label, componentsCount: combo.components.length });
}
