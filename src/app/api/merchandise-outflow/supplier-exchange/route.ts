import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canActOnMerchandiseOutflow } from "@/lib/guards";
import { nextMerchandiseOutflowNumber, formatMerchandiseOutflowCode } from "@/lib/merchandiseOutflow";

const schema = z.object({
  supplierId: z.string().min(1),
  catalogItemId: z.string().min(1).optional(),
  declaredName: z.string().trim().min(1).optional(),
  quantity: z.number().int().positive(),
});

const ITEM_INCLUDE = { catalogItem: { select: { name: true, photos: true } } } as const;

// Cola de cambios con proveedor pendientes de saber si el proveedor
// reemplazó el producto o dio crédito.
export async function GET() {
  if (!(await canActOnMerchandiseOutflow())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  const items = await prisma.merchandiseOutflowItem.findMany({
    where: { batch: { reason: "CAMBIO_PROVEEDOR" }, resolution: null },
    include: { ...ITEM_INCLUDE, batch: { select: { code: true, createdAt: true, supplier: { select: { id: true, name: true } } } } },
    orderBy: { createdAt: "asc" },
  });
  return NextResponse.json(items);
}

// Daniel manda mercadería YA en Just de vuelta a un proveedor para cambio —
// un solo paso, exclusivo de él. Sale de Just en este mismo momento (por
// eso submittedAt queda puesto de una vez, entra directo a la cola de baja),
// la resolución con el proveedor (reemplazo o crédito) se rastrea aparte.
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!(await canActOnMerchandiseOutflow()) || !session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });
  if (!parsed.data.catalogItemId && !parsed.data.declaredName) return NextResponse.json({ error: "Falta el producto." }, { status: 400 });

  const supplier = await prisma.supplier.findUnique({ where: { id: parsed.data.supplierId }, select: { id: true } });
  if (!supplier) return NextResponse.json({ error: "Proveedor no encontrado." }, { status: 404 });

  let declaredName = parsed.data.declaredName ?? "";
  if (parsed.data.catalogItemId) {
    const catalogItem = await prisma.purchaseCatalogItem.findUnique({ where: { id: parsed.data.catalogItemId }, select: { name: true } });
    if (!catalogItem) return NextResponse.json({ error: "Producto no encontrado en el catálogo." }, { status: 404 });
    declaredName = catalogItem.name;
  }

  const batchNumber = await nextMerchandiseOutflowNumber();
  const batch = await prisma.merchandiseOutflowBatch.create({
    data: {
      code: formatMerchandiseOutflowCode(batchNumber),
      batchNumber,
      reason: "CAMBIO_PROVEEDOR",
      createdById: session.user.id,
      submittedAt: new Date(),
      supplierId: parsed.data.supplierId,
      items: {
        create: [{ catalogItemId: parsed.data.catalogItemId ?? null, declaredName, quantity: parsed.data.quantity }],
      },
    },
    include: { items: { include: ITEM_INCLUDE } },
  });

  return NextResponse.json(batch);
}
