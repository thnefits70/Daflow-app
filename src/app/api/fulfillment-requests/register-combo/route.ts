import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { comboCodeUsedByProduct } from "@/lib/comboBrand";
import { aliasEditMessage, comboBrandSchema, confirmAliasResponse, findMotherComboByRecipe, notifyCombosWithoutBrand } from "@/lib/comboAlias";
import { componentsMissingDropiId, missingDropiIdMessage } from "@/lib/fulfillmentGuides";
import { canSubmitFulfillmentRequest, canManageJustCatalog, dbUserId } from "@/lib/guards";

const componentSchema = z.object({ catalogItemId: z.string().min(1), quantity: z.number().int().positive() });
const schema = z.object({ code: z.string().trim().min(1), label: z.string().trim().optional(), bodega: comboBrandSchema.optional(), confirmAlias: z.boolean().optional(), components: z.array(componentSchema).min(1) });

// Confirmado 2026-09-21, pedido explícito del usuario: Yair (Fulfillment)
// conoce de primera mano qué productos reales trae un combo (antes lo
// anotaba a mano en el papel) — puede registrar la receta él mismo desde
// "Solicitud Fulfillment", sin pasar por Daniel. A propósito MÁS ACOTADO
// que /api/dropi-combos (que sí puede sobrescribir cualquier combo): esta
// ruta solo crea un combo nuevo o COMPLETA uno que ya existe pero está
// vacío (0 componentes) — nunca sobrescribe una receta que Daniel ya
// registró con productos reales, para no arriesgar el dato compartido que
// también usa el despacho real (Kardex de INVESTOCK).
// Pedido del usuario 2026-10-10: la marca no la elige quien registra la
// receta (Daniel): sale del PDF de la marca en que vino. Si ya hay un combo con exactamente la misma receta, se pide confirmar que
// es el mismo; recién ahí este ID queda como su ID alterno y toma su marca —
// ver lib/comboAlias.ts.
export async function POST(req: NextRequest) {
  const session = await auth();
  const allowed = (await canSubmitFulfillmentRequest()) || (await canManageJustCatalog());
  if (!allowed || !session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });
  const { code, label, bodega, components } = parsed.data;

  // Regla del usuario 2026-09-23: un combo solo lleva productos con su ID
  // real de Dropi — ver componentsMissingDropiId.
  const missingIds = await componentsMissingDropiId(components.map((c) => c.catalogItemId));
  if (missingIds.length > 0) return NextResponse.json({ error: missingDropiIdMessage(missingIds) }, { status: 400 });

  const existing = await prisma.dropiCombo.findUnique({ where: { code }, include: { components: true, aliasOf: { select: { code: true } } } });
  if (!existing) {
    const clash = await comboCodeUsedByProduct(code);
    if (clash) return NextResponse.json({ error: clash }, { status: 409 });
  }
  if (existing?.aliasOf) return NextResponse.json({ error: aliasEditMessage(code, existing.aliasOf.code) }, { status: 400 });
  if (existing && existing.components.length > 0) {
    return NextResponse.json({ error: "Este combo ya tiene una receta registrada — si crees que está mal, avísale al administrador: solo él la corrige." }, { status: 400 });
  }

  const recipe = components.map((c) => ({ catalogItemId: c.catalogItemId, quantity: c.quantity }));
  const mother = await findMotherComboByRecipe(recipe, code);
  if (mother && !parsed.data.confirmAlias) return NextResponse.json(confirmAliasResponse(mother), { status: 409 });
  // La marca sale del PDF de la marca en que vino (bodega); si vino en un
  // PDF "SinMarca" queda vacía y la elige la asesora B2B (lib/comboAlias.ts).
  const brand = mother?.bodega ?? bodega ?? existing?.bodega ?? null;

  const data = { label: label || existing?.label || null, bodega: brand, aliasOfId: mother?.id ?? null, components: { create: recipe } };
  const combo = existing
    ? await prisma.dropiCombo.update({ where: { id: existing.id }, data, select: { id: true, code: true, label: true, bodega: true } })
    : await prisma.dropiCombo.create({ data: { code, createdById: dbUserId(session.user.id), ...data }, select: { id: true, code: true, label: true, bodega: true } });

  if (!brand) await notifyCombosWithoutBrand([{ code: combo.code, label: combo.label }]).catch(() => null);

  return NextResponse.json({ id: combo.id, code: combo.code, label: combo.label, componentsCount: recipe.length, bodega: combo.bodega, aliasOf: mother?.code ?? null });
}
