import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { canConfirmPersonalPurchaseInventory } from "@/lib/guards";
import { computeUnitPriceModes, attemptAutoPriceOrder, type UnitDeclaration, type PriceMode } from "@/lib/personalPurchases";
import { notifyOwner } from "@/lib/notifications";
import { actorName } from "@/lib/actorName";
import { createOutflowForPersonalPurchaseItem, notifyInventoryLeadOutflowPending } from "@/lib/merchandiseOutflow";

const schema = z.object({
  items: z.array(z.object({ itemId: z.string().min(1), confirmedCatalogItemId: z.string().min(1) })).min(1),
});

// Confirmado 2026-08-20 (revertido el mismo día): la confirmación de Daniel
// es un solo paso — corrige el nombre de cada producto según JUST (con eso
// se calculan las unidades a precio al costo, enfriamiento de 6 meses) Y
// habilita el retiro físico al mismo tiempo. Ya no existe un segundo paso
// manual de "aprobar salida"; el push de "ya podés retirarlo" sale acá
// mismo. A Andrés le llega solo un aviso informativo (campanita).
// Confirmado 2026-09-21, pedido explícito del usuario: el precio ya NO pasa
// por Nairoby — se calcula acá mismo (ver resolveAutoUnitPricing). Ella
// solo vuelve a intervenir si reabre un precio ya cerrado para corregirlo
// (reopen-price), nunca en el primer cierre.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await canConfirmPersonalPurchaseInventory())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { id } = await params;
  const session = await auth();
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });

  const order = await prisma.personalPurchaseOrder.findUnique({
    where: { id },
    include: { employee: { select: { id: true, name: true } }, items: true },
  });
  if (!order) return NextResponse.json({ error: "No encontrado." }, { status: 404 });
  if (order.status !== "PENDING_INVENTORY") return NextResponse.json({ error: "Ya fue procesado." }, { status: 409 });

  const catalogItemIdById = new Map(parsed.data.items.map((i) => [i.itemId, i.confirmedCatalogItemId]));
  for (const it of order.items) {
    if (!catalogItemIdById.has(it.id)) return NextResponse.json({ error: "Falta confirmar el producto de todos los ítems." }, { status: 400 });
  }

  const catalogItems = await prisma.purchaseCatalogItem.findMany({
    where: { id: { in: [...new Set(parsed.data.items.map((i) => i.confirmedCatalogItemId))] } },
    select: { id: true, name: true, justCode: true },
  });
  const catalogById = new Map(catalogItems.map((c) => [c.id, c]));

  const nameById = new Map<string, string>();
  const unitPriceModesById = new Map<string, PriceMode[]>();
  for (const it of order.items) {
    const catalogItemId = catalogItemIdById.get(it.id)!;
    const catalogItem = catalogById.get(catalogItemId);
    const confirmedProductName = catalogItem?.name;
    if (!confirmedProductName) return NextResponse.json({ error: "Producto de catálogo no encontrado." }, { status: 400 });
    nameById.set(it.id, confirmedProductName);
    const declarations = (Array.isArray(it.unitDeclarations) ? it.unitDeclarations : []) as unknown as UnitDeclaration[];
    const unitPriceModes = await computeUnitPriceModes(order.employeeId, confirmedProductName, it.quantity, declarations, catalogItem.justCode, it.id);
    unitPriceModesById.set(it.id, unitPriceModes);
  }

  for (const it of order.items) {
    await prisma.personalPurchaseItem.update({
      where: { id: it.id },
      data: { confirmedProductName: nameById.get(it.id), confirmedCatalogItemId: catalogItemIdById.get(it.id), unitPriceModes: unitPriceModesById.get(it.id) },
    });
  }

  const isAdmin = session!.user.role === "admin";
  const now = new Date();
  await prisma.personalPurchaseOrder.update({
    where: { id },
    data: {
      status: "PENDING_FINANCE",
      inventoryConfirmedAt: now,
      inventoryConfirmedById: isAdmin ? null : session!.user.id,
      pickedUpAt: now,
      pickedUpApprovedById: isAdmin ? null : session!.user.id,
    },
  });

  // Confirmado 2026-09-21, pedido explícito del usuario: el precio ya NO lo
  // escribe Nairoby a mano — se calcula acá mismo con el costo de INVESTOCK
  // (ver attemptAutoPriceOrder/resolveAutoUnitPricing en personalPurchases.ts).
  // Si TODOS los productos tienen costo disponible, la orden salta directo a
  // "elegir cómo pagar" (se salta por completo el paso de Finanzas). Si a
  // alguno le falta costo, se queda esperando en PENDING_FINANCE — nadie lo
  // puede forzar a mano, queda como pendiente informativo hasta que ese
  // producto tenga costo cargado en INVESTOCK (o hasta que admin reintente
  // desde retry-auto-price una vez cargado).
  const priceResult = await attemptAutoPriceOrder(id);
  const allPriced = priceResult.priced;
  const totalAmount = priceResult.priced ? priceResult.totalAmount : 0;
  const updated = await prisma.personalPurchaseOrder.findUnique({ where: { id } });

  // Confirmado 2026-08-25: enganche automático a Registro de Egresos — en
  // cuanto Daniel aprueba el retiro físico, cada producto de la orden cae
  // solo a la cola de "dar de baja en Just", sin que nadie lo vuelva a
  // registrar a mano en otro lugar.
  for (const it of order.items) {
    await createOutflowForPersonalPurchaseItem({ itemId: it.id, productName: nameById.get(it.id)!, catalogItemId: catalogItemIdById.get(it.id), quantity: it.quantity }).catch(() => null);
  }
  await notifyInventoryLeadOutflowPending({ code: `compras personales · ${order.employee.name}`, reason: "COMPRA_PERSONAL" });

  const itemCount = order.items.length;
  await notifyOwner("admin", {
    title: "🛒 Compra personal confirmada por bodega",
    body: `${order.employee.name} · ${itemCount} producto${itemCount === 1 ? "" : "s"} · confirmado por ${actorName(isAdmin ? null : session!.user.name)}${allPriced ? "" : " · esperando costo en INVESTOCK"}`,
    url: "/area/nomina?tab=pagos&ptab=comprasfinanzas",
  });

  await notifyOwner(order.employee.id, {
    title: "✅ Ya podés retirarlo",
    body: "Daniel ya lo tiene listo en bodega.",
    url: "/area/compras-personales",
  });

  // Confirmado 2026-09-21, pedido explícito del usuario: el precio ya no lo
  // cierra Nairoby a mano — si se pudo calcular acá mismo, el colaborador ya
  // se entera del monto de una, sin esperar a nadie más.
  if (allPriced) {
    await notifyOwner(order.employee.id, {
      title: "💵 Tu compra personal quedó lista",
      body: `Total $${totalAmount.toFixed(2)} — elegí cómo pagarla.`,
      url: "/area/compras-personales",
    });
  }

  return NextResponse.json(updated);
}
