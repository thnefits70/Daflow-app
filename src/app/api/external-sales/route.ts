import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canDeclareExternalSales } from "@/lib/guards";
import { nextExternalSaleNumber, formatExternalSaleCode } from "@/lib/merchandiseOutflow";
import { notifyMarketingLeadNewExternalSale } from "@/lib/externalSales";

const SALE_INCLUDE = {
  items: { include: { catalogItem: { select: { name: true, photos: true, justCode: true } } }, orderBy: { createdAt: "asc" } },
  advisor: { select: { name: true } },
  reviewedBy: { select: { name: true } },
  dispatchAssignedTo: { select: { name: true } },
  client: true,
} as const;

const itemSchema = z.object({
  catalogItemId: z.string().min(1, "Falta el producto."),
  quantity: z.number().int().positive(),
  unitPrice: z.number().positive(),
});

const schema = z.object({
  items: z.array(itemSchema).min(1, "Agrega al menos un producto."),
  pickupPersonName: z.string().trim().min(1, "Falta a quién debe entregársela bodega."),
  courierNote: z.string().trim().optional(),
  clientId: z.string().min(1, "Falta matricular o seleccionar al cliente."),
});

// Resuelve cada renglón contra el catálogo real y arma los datos listos
// para prisma.externalSaleItem.create (nombre congelado + total calculado).
async function resolveItems(items: z.infer<typeof itemSchema>[]) {
  const catalogItems = await prisma.purchaseCatalogItem.findMany({
    where: { id: { in: items.map((it) => it.catalogItemId) } },
    select: { id: true, name: true },
  });
  const byId = new Map(catalogItems.map((c) => [c.id, c.name]));
  for (const it of items) {
    if (!byId.has(it.catalogItemId)) throw new Error("Uno de los productos no se encontró en el catálogo.");
  }
  return items.map((it) => ({
    catalogItemId: it.catalogItemId,
    declaredProductName: byId.get(it.catalogItemId)!,
    quantity: it.quantity,
    unitPrice: it.unitPrice,
    totalAmount: it.quantity * it.unitPrice,
  }));
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

  let resolvedItems;
  try {
    resolvedItems = await resolveItems(parsed.data.items);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Producto no encontrado en el catálogo." }, { status: 404 });
  }

  const advisor = await prisma.user.findUnique({ where: { id: session.user.id }, select: { externalSaleContraEntrega: true } });

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
      isContraEntrega: !!advisor?.externalSaleContraEntrega,
    },
    include: SALE_INCLUDE,
  });

  await notifyMarketingLeadNewExternalSale(sale.code);
  return NextResponse.json(sale);
}
