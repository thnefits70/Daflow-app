import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canManageJustCatalog, dbUserId } from "@/lib/guards";
import {
  resolveCostBasisForCatalogItems,
  computeComboBenistockPrice,
  computeComboB2BPrice,
  computeComboDropiPrice,
  computeComboB2CPrice,
  bodegaUnitCost,
  B2B_MARGIN_DEFAULT,
  DROPI_MARGIN_DEFAULT,
  type ComboComponentInput,
} from "@/lib/marketProduct";

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

  // Confirmado 2026-09-16, pedido explícito del usuario: los mismos
  // precios de combo que ya existen (Consulta de precios, vista previa al
  // armar uno) también acá, en el listado — mismo criterio de costo
  // (proposal-o-Kardex) que usa el resto de la app. Si a algún componente
  // le falta el costo, el combo entero queda sin precios (null), nunca a
  // medias.
  const allComponentIds = [...new Set(combos.flatMap((c) => c.components.map((comp) => comp.catalogItemId)))];
  const costBasisByItemId = await resolveCostBasisForCatalogItems(allComponentIds);

  return NextResponse.json(
    combos.map((c) => {
      const costBasisList = c.components.every((comp) => costBasisByItemId.has(comp.catalogItemId))
        ? c.components.map((comp) => costBasisByItemId.get(comp.catalogItemId)!)
        : null;
      const componentInputs: ComboComponentInput[] | null = costBasisList
        ? costBasisList.map((cb, i) => ({ ...cb, quantity: c.components[i].quantity }))
        : null;
      // Confirmado 2026-09-16, pedido explícito del usuario: mismo formato de
      // columnas que los productos individuales (Proveedor/Puesto en
      // bodega) — para un combo, cada uno es la suma de ese costo × cantidad
      // de todos sus componentes (no hay un solo "precio proveedor" para un
      // combo, así que se suma el total real que cuesta armarlo completo).
      // Si algún componente usa el costo de Kardex (menos detallado que una
      // propuesta de Jariel), el combo entero se marca con ese.
      const costSource = costBasisList
        ? costBasisList.some((cb) => cb.costSource === "kardex")
          ? ("kardex" as const)
          : ("proposal" as const)
        : null;
      const prices = componentInputs
        ? {
            costSource,
            providerPrice: componentInputs.reduce((acc, c) => acc + c.batchCost * c.quantity, 0),
            bodegaPrice: componentInputs.reduce((acc, c) => acc + bodegaUnitCost(c.batchCost, c.freightCost, c.batchUnits) * c.quantity, 0),
            benistockPrice: computeComboBenistockPrice(componentInputs),
            b2bPriceDefault: computeComboB2BPrice(componentInputs, B2B_MARGIN_DEFAULT),
            dropiPrice: computeComboDropiPrice(componentInputs, DROPI_MARGIN_DEFAULT),
            b2cPrice1Unit: computeComboB2CPrice(componentInputs, 1),
            b2cPrice2to11: computeComboB2CPrice(componentInputs, 2),
          }
        : { costSource: null, providerPrice: null, bodegaPrice: null, benistockPrice: null, b2bPriceDefault: null, dropiPrice: null, b2cPrice1Unit: null, b2cPrice2to11: null };
      return {
        id: c.id,
        code: c.code,
        label: c.label,
        bodega: c.bodega,
        createdByName: c.createdBy?.name ?? null,
        createdAt: c.createdAt,
        components: c.components.map((comp) => ({ id: comp.id, quantity: comp.quantity, catalogItem: comp.catalogItem })),
        ...prices,
      };
    })
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
          createdById: dbUserId(session.user.id),
          components: { create: parsed.data.components.map((c) => ({ catalogItemId: c.catalogItemId, quantity: c.quantity })) },
        },
        include: { components: { include: { catalogItem: { select: CATALOG_ITEM_SELECT } } } },
      });
  return NextResponse.json(combo);
}
