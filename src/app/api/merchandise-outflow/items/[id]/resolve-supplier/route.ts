import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { outflowItemDisplayName, resolveOutflowItemGestorId } from "@/lib/merchandiseOutflow";

const schema = z.discriminatedUnion("resolution", [
  z.object({ resolution: z.literal("REPLACED"), note: z.string().trim().optional() }),
  z.object({
    resolution: z.literal("CREDIT_ISSUED"),
    amount: z.number().positive(),
    proofUrl: z.string().url({ message: "Falta el comprobante — captura del chat o documento donde el proveedor acepta el crédito." }),
    proofName: z.string().trim().optional(),
    note: z.string().trim().optional(),
  }),
]);

// Confirmado 2026-08-26, pedido explícito del usuario: quien resuelve
// (cambio o crédito) ya no es Daniel — es quien solicitó ORIGINALMENTE la
// compra de ese producto a ese proveedor (linkedPurchaseRequest.requestedBy),
// o Bryan si el producto no tiene compra vinculada (ver
// resolveOutflowItemGestorId). Daniel y admin quedan en modo lectura.
// REPLACED cierra el seguimiento (la llegada física del reemplazo se maneja
// por la recepción normal de Compras). CREDIT_ISSUED crea el SupplierCredit
// correspondiente, mismo patrón que el crédito manual de Control de Compras
// (comprobante obligatorio).
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
      batch: { select: { reason: true, supplierId: true, submittedAt: true, code: true } },
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

  if (parsed.data.resolution === "REPLACED") {
    const updated = await prisma.merchandiseOutflowItem.update({
      where: { id },
      data: { resolution: "REPLACED", resolutionNote: parsed.data.note?.trim() || null, resolvedAt: new Date(), resolvedById: session.user.id },
    });
    return NextResponse.json(updated);
  }

  const [updated] = await prisma.$transaction([
    prisma.merchandiseOutflowItem.update({
      where: { id },
      data: { resolution: "CREDIT_ISSUED", resolutionNote: parsed.data.note?.trim() || null, resolvedAt: new Date(), resolvedById: session.user.id },
    }),
    prisma.supplierCredit.create({
      data: {
        supplierId: item.batch.supplierId,
        amount: parsed.data.amount,
        reason: `Cambio con proveedor — ${outflowItemDisplayName(item)} (${item.batch.code})`,
        proofUrl: parsed.data.proofUrl,
        proofName: parsed.data.proofName || null,
        status: "AVAILABLE",
        outflowItemId: id,
        createdById: session.user.id,
      },
    }),
  ]);

  return NextResponse.json(updated);
}
