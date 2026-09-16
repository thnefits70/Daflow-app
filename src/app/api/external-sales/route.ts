import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canDeclareExternalSales } from "@/lib/guards";
import { nextExternalSaleNumber, formatExternalSaleCode } from "@/lib/merchandiseOutflow";
import { notifyMarketingLeadNewExternalSale, priceExternalSaleItems } from "@/lib/externalSales";

const SALE_INCLUDE = {
  items: { include: { catalogItem: { select: { name: true, photos: true, justCode: true } } }, orderBy: { createdAt: "asc" } },
  advisor: { select: { name: true } },
  reviewedBy: { select: { name: true } },
  dispatchAssignedTo: { select: { name: true } },
  paymentConfirmedBy: { select: { name: true } },
  invoiceUploadedBy: { select: { name: true } },
  prepReadyBy: { select: { name: true } },
  packAssignedTo: { select: { name: true } },
  deliveredBy: { select: { name: true } },
  client: true,
} as const;

const itemSchema = z.object({
  catalogItemId: z.string().min(1, "Falta el producto."),
  quantity: z.number().int().positive(),
  // Solo aplica en ventas B2B (pago anticipado) — el asesor elige el
  // porcentaje de ganancia; en B2C se ignora, se calcula solo según la
  // cantidad total de la venta.
  marginPercent: z.number().optional(),
  // Confirmado 2026-09-15, pedido explícito de Marcos: foto de referencia
  // opcional que el asesor adjunta cuando el producto todavía no está
  // matriculado en el catálogo (sin fotos reales) — evita que Fulfillment
  // despache el producto equivocado adivinando solo por el nombre.
  sellerReferencePhotoUrl: z.string().url().optional(),
});

const schema = z.object({
  items: z.array(itemSchema).min(1, "Agrega al menos un producto."),
  pickupPersonName: z.string().trim().min(1, "Falta a quién debe entregársela bodega."),
  courierNote: z.string().trim().optional(),
  clientId: z.string().min(1, "Falta matricular o seleccionar al cliente."),
  freightCost: z.number().min(0).optional(),
  // Solo tiene efecto real cuando el asesor vende contra entrega — en pago
  // anticipado la factura es obligatoria sin importar esto.
  facturaSolicitada: z.enum(["SI", "NO", "PENDIENTE"]).optional(),
});

// Resuelve cada renglón contra el catálogo real y el precio calculado
// (nunca se confía en un precio que mande el navegador — ver
// priceExternalSaleItems en lib/externalSales.ts) y arma los datos listos
// para prisma.externalSaleItem.create.
async function resolveItems(items: z.infer<typeof itemSchema>[], isContraEntrega: boolean) {
  const catalogItems = await prisma.purchaseCatalogItem.findMany({
    where: { id: { in: items.map((it) => it.catalogItemId) } },
    select: { id: true, name: true },
  });
  const byId = new Map(catalogItems.map((c) => [c.id, c.name]));
  for (const it of items) {
    if (!byId.has(it.catalogItemId)) throw new Error("Uno de los productos no se encontró en el catálogo.");
  }

  const priced = await priceExternalSaleItems({ isContraEntrega, items });
  if (!priced.ok) throw new Error(priced.error);

  return items.map((it, i) => {
    const price = priced.items[i];
    return {
      catalogItemId: it.catalogItemId,
      declaredProductName: byId.get(it.catalogItemId)!,
      quantity: it.quantity,
      unitPrice: price.unitPrice,
      totalAmount: it.quantity * price.unitPrice,
      marginPercentUsed: price.marginPercentUsed,
      sellerReferencePhotoUrl: it.sellerReferencePhotoUrl ?? null,
    };
  });
}

// Las propias declaraciones del asesor — para seguir su estado y subir el
// comprobante de pago una vez aprobadas.
export async function GET() {
  const session = await auth();
  if (!(await canDeclareExternalSales()) || !session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const sales = await prisma.externalSale.findMany({
    where: { advisorId: session.user.id },
    include: SALE_INCLUDE,
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json(sales);
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!(await canDeclareExternalSales()) || !session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });

  const client = await prisma.client.findUnique({ where: { id: parsed.data.clientId }, select: { id: true } });
  if (!client) return NextResponse.json({ error: "Cliente no encontrado." }, { status: 404 });

  const advisor = await prisma.user.findUnique({ where: { id: session.user.id }, select: { externalSaleContraEntrega: true } });
  const isContraEntrega = !!advisor?.externalSaleContraEntrega;

  let resolvedItems;
  try {
    resolvedItems = await resolveItems(parsed.data.items, isContraEntrega);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "No se pudo calcular el precio." }, { status: 400 });
  }

  const saleNumber = await nextExternalSaleNumber();
  const sale = await prisma.externalSale.create({
    data: {
      code: formatExternalSaleCode(saleNumber),
      saleNumber,
      advisorId: session.user.id,
      totalAmount: resolvedItems.reduce((sum, it) => sum + it.totalAmount, 0),
      items: { create: resolvedItems },
      pickupPersonName: parsed.data.pickupPersonName,
      courierNote: parsed.data.courierNote?.trim() || null,
      clientId: parsed.data.clientId,
      isContraEntrega,
      freightCost: parsed.data.freightCost ?? null,
      facturaSolicitada: isContraEntrega ? (parsed.data.facturaSolicitada ?? "PENDIENTE") : "PENDIENTE",
    },
    include: SALE_INCLUDE,
  });

  await notifyMarketingLeadNewExternalSale(sale.code);
  return NextResponse.json(sale);
}
