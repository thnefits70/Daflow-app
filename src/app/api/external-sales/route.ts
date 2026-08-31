import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canDeclareExternalSales } from "@/lib/guards";
import { nextExternalSaleNumber, formatExternalSaleCode } from "@/lib/merchandiseOutflow";
import { notifyMarketingLeadNewExternalSale } from "@/lib/externalSales";

const SALE_INCLUDE = {
  catalogItem: { select: { name: true, photos: true, justCode: true } },
  advisor: { select: { name: true } },
  reviewedBy: { select: { name: true } },
  dispatchAssignedTo: { select: { name: true } },
  client: true,
} as const;

const schema = z.object({
  catalogItemId: z.string().min(1).optional(),
  declaredProductName: z.string().trim().min(1).optional(),
  quantity: z.number().int().positive(),
  unitPrice: z.number().positive(),
  pickupPersonName: z.string().trim().min(1, "Falta a quién debe entregársela bodega."),
  courierNote: z.string().trim().optional(),
  clientId: z.string().min(1, "Falta matricular o seleccionar al cliente."),
});

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
  if (!parsed.data.catalogItemId && !parsed.data.declaredProductName) return NextResponse.json({ error: "Falta el producto." }, { status: 400 });

  const client = await prisma.client.findUnique({ where: { id: parsed.data.clientId }, select: { id: true } });
  if (!client) return NextResponse.json({ error: "Cliente no encontrado." }, { status: 404 });

  let declaredProductName = parsed.data.declaredProductName ?? "";
  if (parsed.data.catalogItemId) {
    const catalogItem = await prisma.purchaseCatalogItem.findUnique({ where: { id: parsed.data.catalogItemId }, select: { name: true } });
    if (!catalogItem) return NextResponse.json({ error: "Producto no encontrado en el catálogo." }, { status: 404 });
    declaredProductName = catalogItem.name;
  }

  const advisor = await prisma.user.findUnique({ where: { id: session.user.id }, select: { externalSaleContraEntrega: true } });

  const saleNumber = await nextExternalSaleNumber();
  const sale = await prisma.externalSale.create({
    data: {
      code: formatExternalSaleCode(saleNumber),
      saleNumber,
      advisorId: session.user.id,
      catalogItemId: parsed.data.catalogItemId ?? null,
      declaredProductName,
      quantity: parsed.data.quantity,
      unitPrice: parsed.data.unitPrice,
      totalAmount: parsed.data.quantity * parsed.data.unitPrice,
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
