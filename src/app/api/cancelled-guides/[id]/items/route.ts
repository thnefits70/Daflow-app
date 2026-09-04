import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canAssignCancelledGuideItems } from "@/lib/guards";
import { notifyInventoryLeadCancelledGuidesReady } from "@/lib/cancelledGuides";

const schema = z.object({
  items: z
    .array(z.object({ catalogItemId: z.string().min(1).optional(), declaredName: z.string().trim().min(1).optional(), quantity: z.number().int().positive() }))
    .min(1, "Agregá al menos un producto."),
});

// Heidy (o quien tenga el flag) carga qué productos y cantidades venían en
// esta guía. Corre EN PARALELO con la gestión de Bryan y la confirmación de
// Yair (pedido explícito del usuario, 2026-09-02/03) — no espera ninguna de
// las dos. La cola de Daniel solo se habilita cuando los TRES pasos están
// listos (ver pending-reingreso), así que acá solo avisamos a Daniel si
// Bryan ya gestionó Y Yair ya confirmó la salida de Fulfillment de este
// lote; si no, el aviso sale después, desde /confirm-removal.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!(await canAssignCancelledGuideItems()) || !session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { id } = await params;
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });

  const report = await prisma.cancelledGuideReport.findUnique({ where: { id }, select: { code: true, batchManagedAt: true, itemsAssignedAt: true, fulfillmentRemovedAt: true } });
  if (!report) return NextResponse.json({ error: "No encontrado." }, { status: 404 });
  if (report.itemsAssignedAt) return NextResponse.json({ error: "Esta guía ya tiene productos cargados." }, { status: 409 });

  const catalogIds = parsed.data.items.map((i) => i.catalogItemId).filter((cid): cid is string => !!cid);
  const catalogItems = catalogIds.length
    ? await prisma.purchaseCatalogItem.findMany({ where: { id: { in: catalogIds } }, select: { id: true, name: true } })
    : [];
  const nameById = new Map(catalogItems.map((c) => [c.id, c.name]));

  const itemsData = [];
  for (const item of parsed.data.items) {
    if (!item.catalogItemId && !item.declaredName) return NextResponse.json({ error: "Falta el producto en uno de los renglones." }, { status: 400 });
    const declaredName = item.catalogItemId ? nameById.get(item.catalogItemId) : item.declaredName?.trim();
    if (!declaredName) return NextResponse.json({ error: "Producto no encontrado en el catálogo." }, { status: 404 });
    itemsData.push({ catalogItemId: item.catalogItemId ?? null, declaredName, quantity: item.quantity });
  }

  const updated = await prisma.cancelledGuideReport.update({
    where: { id },
    data: { itemsAssignedAt: new Date(), itemsAssignedById: session.user.id, items: { create: itemsData } },
    include: { items: { include: { catalogItem: { select: { name: true, justCode: true } } } } },
  });

  if (report.batchManagedAt && report.fulfillmentRemovedAt) await notifyInventoryLeadCancelledGuidesReady([report.code]);
  return NextResponse.json(updated);
}
