import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { comboCodeUsedByProduct } from "@/lib/comboBrand";
import { canRegisterAdvisorCombo, comboBrandSchema, confirmAliasResponse, findMotherComboByRecipe } from "@/lib/comboAlias";
import { componentsMissingDropiId, missingDropiIdMessage } from "@/lib/fulfillmentGuides";
import { dbUserId } from "@/lib/guards";

const componentSchema = z.object({ catalogItemId: z.string().min(1), quantity: z.number().int().positive() });
const schema = z.object({
  platform: z.enum(["DROPI", "ROCKET"]),
  id: z.string().trim().regex(/^\d+$/, "El ID va solo con números."),
  label: z.string().trim().min(1, "Escribe el nombre del combo."),
  bodega: comboBrandSchema,
  confirmAlias: z.boolean().optional(),
  components: z.array(componentSchema).min(2, "Un combo trae al menos 2 productos (o 2 unidades: agrega el producto con su cantidad)."),
});

// Pedido del usuario 2026-10-10: el asesor que crea un combo en Dropi o en
// Rocket lo registra aquí al crearlo — marca y productos obligatorios, con
// doble confirmación — para que el corte ya lo reconozca y esa información
// nunca falte en los demás flujos. Igual que en el corte: si la receta ya
// existe con otro ID, se pide confirmar que es el mismo y se une al primero.
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session || !(await canRegisterAdvisorCombo())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });
  const { platform, id, label, bodega, confirmAlias, components } = parsed.data;
  if (new Set(components.map((c) => c.catalogItemId)).size !== components.length) {
    return NextResponse.json({ error: "Pusiste el mismo producto dos veces — junta la cantidad en una sola fila." }, { status: 400 });
  }
  if (components.length === 1 && components[0].quantity < 2) {
    return NextResponse.json({ error: "Un combo trae al menos 2 productos (o 2 unidades del mismo)." }, { status: 400 });
  }
  const missingIds = await componentsMissingDropiId(components.map((c) => c.catalogItemId));
  if (missingIds.length > 0) return NextResponse.json({ error: missingDropiIdMessage(missingIds) }, { status: 400 });

  const code = platform === "ROCKET" ? `R${id}` : id;
  const where = platform === "ROCKET" ? "Rocket" : "Dropi";
  const [existing, rocketLink] = await Promise.all([
    prisma.dropiCombo.findUnique({ where: { code }, select: { id: true, components: { select: { id: true } } } }),
    platform === "ROCKET" ? prisma.rocketCodeMapping.findUnique({ where: { rocketCode: id }, select: { id: true } }) : Promise.resolve(null),
  ]);
  if ((existing && existing.components.length > 0) || rocketLink) {
    return NextResponse.json({ error: `El ID ${id} de ${where} ya está registrado en DAFLOW.` }, { status: 409 });
  }
  if (platform === "DROPI") {
    const clash = await comboCodeUsedByProduct(code);
    if (clash) return NextResponse.json({ error: clash }, { status: 409 });
  }

  const mother = await findMotherComboByRecipe(components, code);
  if (mother && !confirmAlias) return NextResponse.json(confirmAliasResponse(mother), { status: 409 });

  const userId = dbUserId(session.user.id);
  // Rocket ya tiene su vínculo propio (RocketCodeMapping) hacia el combo madre.
  if (mother && platform === "ROCKET") {
    await prisma.rocketCodeMapping.create({ data: { rocketCode: id, rocketName: label, dropiComboId: mother.id, createdById: userId } });
    return NextResponse.json({ code, aliasOf: mother.code, bodega: mother.bodega });
  }

  const data = { label, bodega: mother?.bodega ?? bodega, aliasOfId: mother?.id ?? null, components: { create: components } };
  const combo = existing
    ? await prisma.dropiCombo.update({ where: { id: existing.id }, data, select: { code: true, bodega: true } })
    : await prisma.dropiCombo.create({ data: { code, createdById: userId, ...data }, select: { code: true, bodega: true } });
  return NextResponse.json({ code: combo.code, aliasOf: mother?.code ?? null, bodega: combo.bodega });
}
