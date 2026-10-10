import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { isRocketCode } from "@/lib/dropiGuidesPdf";
import { comboBrandSchema, confirmAliasResponse, findMotherComboByRecipe, notifyCombosWithoutBrand } from "@/lib/comboAlias";
import { componentsMissingDropiId, missingDropiIdMessage } from "@/lib/fulfillmentGuides";
import { canSubmitFulfillmentRequest, canManageJustCatalog, dbUserId } from "@/lib/guards";

const componentSchema = z.object({ catalogItemId: z.string().min(1), quantity: z.number().int().positive() });
const schema = z.object({ rocketCode: z.string().trim().min(2), label: z.string().trim().optional(), bodega: comboBrandSchema.optional(), confirmAlias: z.boolean().optional(), components: z.array(componentSchema).min(1) });

// Pedido del usuario 2026-09-28: un combo de Rocket se registra igual que uno
// de Dropi — Yair pone qué productos reales trae (con su ID de INVESTOCK). El
// ID de Rocket siempre es distinto al de Dropi, aunque el combo traiga los
// mismos productos. Si ya existe un combo con exactamente la misma receta, se
// usa ese (el vínculo Rocket → combo se guarda al "Guardar" las guías, en
// RocketCodeMapping). Si no, se crea un combo propio con el código de Rocket
// ("R…"), que nunca choca con un ID de Dropi.
// Pedido del usuario 2026-10-10: el combo que existe solo en Rocket también
// lleva su marca madre, que elige la asesora B2B; el que se reutiliza
// es siempre el madre (el primero registrado), nunca un ID alterno, y solo
// después de que quien registra confirma que es el mismo combo.
export async function POST(req: NextRequest) {
  const session = await auth();
  const allowed = (await canSubmitFulfillmentRequest()) || (await canManageJustCatalog());
  if (!allowed || !session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });
  const { rocketCode, label, bodega, confirmAlias, components } = parsed.data;
  if (!isRocketCode(rocketCode)) return NextResponse.json({ error: "Ese no es un ID de Rocket." }, { status: 400 });
  if (new Set(components.map((c) => c.catalogItemId)).size !== components.length) {
    return NextResponse.json({ error: "Pusiste el mismo producto dos veces — junta las cantidades en una sola línea." }, { status: 400 });
  }

  const missingIds = await componentsMissingDropiId(components.map((c) => c.catalogItemId));
  if (missingIds.length > 0) return NextResponse.json({ error: missingDropiIdMessage(missingIds) }, { status: 400 });

  const mother = await findMotherComboByRecipe(components);
  if (mother) {
    if (!confirmAlias) return NextResponse.json(confirmAliasResponse(mother), { status: 409 });
    return NextResponse.json({ code: mother.code, reused: true, bodega: mother.bodega });
  }

  const own = await prisma.dropiCombo.findUnique({ where: { code: rocketCode }, select: { bodega: true, components: { select: { id: true } } } });
  if (own && own.components.length > 0) {
    return NextResponse.json({ error: "Este combo de Rocket ya tiene otra receta registrada — si está mal, avísale al administrador: solo él la corrige." }, { status: 400 });
  }
  // Un PDF de Rocket no dice la marca: queda vacía y la elige la asesora B2B.
  const brand = bodega ?? own?.bodega ?? null;
  const recipe = { create: components.map((c) => ({ catalogItemId: c.catalogItemId, quantity: c.quantity })) };
  const combo = own
    ? await prisma.dropiCombo.update({ where: { code: rocketCode }, data: { bodega: brand, components: recipe }, select: { code: true } })
    : await prisma.dropiCombo.create({
        data: { code: rocketCode, label: `${label || "Combo"} (Rocket)`, bodega: brand, createdById: dbUserId(session.user.id), components: recipe },
        select: { code: true },
      });
  if (!brand) await notifyCombosWithoutBrand([{ code: rocketCode, label: label ? `${label} (Rocket)` : null }]).catch(() => null);
  return NextResponse.json({ code: combo.code, reused: false, bodega: brand });
}
