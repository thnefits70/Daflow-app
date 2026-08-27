import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { outflowItemDisplayName, resolveOutflowItemGestorId, notifySupplierExchangeRejected } from "@/lib/merchandiseOutflow";

const schema = z.discriminatedUnion("resolution", [
  z.object({ resolution: z.literal("REPLACED"), quantity: z.number().int().positive().optional(), note: z.string().trim().optional() }),
  z.object({
    resolution: z.literal("CREDIT_ISSUED"),
    quantity: z.number().int().positive().optional(),
    amount: z.number().positive(),
    proofUrl: z.string().url({ message: "Falta el comprobante — captura del chat o documento donde el proveedor acepta el crédito." }),
    proofName: z.string().trim().optional(),
    note: z.string().trim().optional(),
  }),
  z.object({
    resolution: z.literal("REJECTED"),
    quantity: z.number().int().positive().optional(),
    note: z.string().trim().min(1, "Cuenta qué te dijo el proveedor — esto dispara avisos urgentes."),
    proofUrl: z.string().url().optional(),
    proofName: z.string().trim().optional(),
  }),
]);

// Confirmado 2026-08-26/27, pedido explícito del usuario: quien resuelve
// (cambio, crédito o rechazo) ya no es Daniel — es quien solicitó
// ORIGINALMENTE la compra de ese producto a ese proveedor
// (linkedPurchaseRequest.requestedBy), o Bryan si el producto no tiene
// compra vinculada (ver resolveOutflowItemGestorId). Daniel y admin quedan
// en modo lectura sobre esta decisión.
// REPLACED cierra el seguimiento. CREDIT_ISSUED crea el SupplierCredit
// correspondiente. REJECTED (confirmado 2026-08-27) no crea crédito — es una
// pérdida real, dispara avisos urgentes a admin/Nairoby/Daniel.
// `quantity` (confirmado 2026-08-27, pedido explícito: "respuesta mixta") es
// opcional — por defecto resuelve TODA la cantidad del ítem. Si se manda una
// cantidad MENOR, se parte el ítem en dos dentro de una sola transacción: un
// ítem nuevo, ya resuelto, con esa cantidad, y el ítem original se queda con
// el resto, todavía pendiente — para que el mismo producto pueda tener
// varias respuestas distintas (ej. de 3 unidades, 2 cambiadas y 1 con
// crédito), sin dejar nunca un ítem huérfano si algo falla a mitad de camino.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { id } = await params;
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });

  const item = await prisma.merchandiseOutflowItem.findUnique({
    where: { id },
    include: {
      batch: { select: { reason: true, supplierId: true, submittedAt: true, code: true, supplier: { select: { name: true } } } },
      catalogItem: { select: { name: true } },
      linkedPurchaseRequest: { select: { requestedById: true } },
    },
  });
  if (!item) return NextResponse.json({ error: "No encontrado." }, { status: 404 });
  if (item.batch.reason !== "CAMBIO_PROVEEDOR" || !item.batch.supplierId) return NextResponse.json({ error: "Este ítem no es de cambio con proveedor." }, { status: 400 });
  if (!item.batch.submittedAt) return NextResponse.json({ error: "Esta solicitud todavía no se ha enviado." }, { status: 409 });
  if (item.resolution) return NextResponse.json({ error: "Este ítem ya fue resuelto." }, { status: 409 });

  const gestorId = await resolveOutflowItemGestorId(item);
  if (gestorId !== session.user.id) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const resolveQty = parsed.data.quantity ?? item.quantity;
  if (resolveQty > item.quantity) return NextResponse.json({ error: "La cantidad no puede ser mayor a la que queda pendiente." }, { status: 400 });
  const isPartial = resolveQty < item.quantity;
  const remainingQty = item.quantity - resolveQty;
  const proportionalCredit = (qty: number) => (item.unitCostAtExchange != null ? item.unitCostAtExchange * qty : null);
  const note = "note" in parsed.data ? parsed.data.note?.trim() || null : null;
  const now = new Date();

  const resolvedItemId = await prisma.$transaction(async (tx) => {
    let targetId = id;
    if (isPartial) {
      const split = await tx.merchandiseOutflowItem.create({
        data: {
          batchId: item.batchId,
          catalogItemId: item.catalogItemId,
          declaredName: item.declaredName,
          quantity: resolveQty,
          linkedPurchaseRequestId: item.linkedPurchaseRequestId,
          unitCostAtExchange: item.unitCostAtExchange,
          expectedCreditAmount: proportionalCredit(resolveQty),
        },
      });
      targetId = split.id;
      await tx.merchandiseOutflowItem.update({
        where: { id },
        data: { quantity: remainingQty, expectedCreditAmount: proportionalCredit(remainingQty) },
      });
    }

    await tx.merchandiseOutflowItem.update({
      where: { id: targetId },
      data: { resolution: parsed.data.resolution, resolutionNote: note, resolvedAt: now, resolvedById: session.user.id },
    });

    if (parsed.data.resolution === "CREDIT_ISSUED") {
      await tx.supplierCredit.create({
        data: {
          supplierId: item.batch.supplierId!,
          amount: parsed.data.amount,
          reason: `Cambio con proveedor — ${outflowItemDisplayName(item)} (${item.batch.code})`,
          proofUrl: parsed.data.proofUrl,
          proofName: parsed.data.proofName || null,
          status: "AVAILABLE",
          outflowItemId: targetId,
          createdById: session.user.id,
        },
      });
    }

    return targetId;
  });

  if (parsed.data.resolution === "REJECTED") {
    await notifySupplierExchangeRejected({
      quantity: resolveQty,
      declaredName: item.declaredName,
      catalogItem: item.catalogItem,
      batch: { code: item.batch.code, supplier: item.batch.supplier },
    }).catch(() => null);
  }

  const finalItem = await prisma.merchandiseOutflowItem.findUnique({ where: { id: resolvedItemId } });
  return NextResponse.json(finalItem);
}
