import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canManageOutflowPurchaseGestion } from "@/lib/guards";
import { notifyInventoryLeadDeteriorPurchaseResolved, outflowItemDisplayName } from "@/lib/merchandiseOutflow";
import { notifyOwner } from "@/lib/notifications";

const schema = z.discriminatedUnion("resolution", [
  z.object({ resolution: z.literal("REPLACED"), note: z.string().trim().optional() }),
  z.object({
    resolution: z.literal("CREDIT_ISSUED"),
    amount: z.number().positive(),
    proofUrl: z.string().url({ message: "Falta el comprobante — captura del chat o documento donde el proveedor acepta el crédito." }),
    proofName: z.string().trim().optional(),
    note: z.string().trim().optional(),
  }),
  // Confirmado 2026-09-23, revisión anti-fraude pedida por el usuario: un
  // rechazo ya no se cierra solo con una nota — hace falta la captura del
  // proveedor, y se le avisa al admin.
  z.object({
    resolution: z.literal("REJECTED"),
    note: z.string().trim().min(1, "Cuenta qué te dijo el proveedor."),
    proofUrl: z.string().url({ message: "Sube la captura donde el proveedor rechaza el reclamo." }),
  }),
]);

// Confirmado 2026-09-17, pedido explícito del usuario: Jariel registra el
// resultado de gestionar un DETERIORO escalado con el proveedor — mismo
// patrón que resolve-supplier/route.ts (CAMBIO_PROVEEDOR), pero acá
// purchaseResolution es un campo APARTE de `resolution` (que se queda fijo
// en ESCALATED_TO_PURCHASES, la decisión de Daniel). Requiere que el
// reclamo ya esté anclado a una compra real (linkedPurchaseRequestId, ver
// purchase-link/route.ts) — la ÚNICA excepción es que admin ya haya
// autorizado seguir sin respaldo (purchaseExceptionDecision AUTHORIZED, ver
// purchase-exception-decide/route.ts). Este producto ya se descontó de
// INVESTOCK al enviarse el lote — acá no se vuelve a tocar Kardex,
// esto es puramente la parte financiera con el proveedor.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session || !(await canManageOutflowPurchaseGestion())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { id } = await params;
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });

  const item = await prisma.merchandiseOutflowItem.findUnique({
    where: { id },
    include: { batch: { select: { reason: true } }, catalogItem: { select: { name: true } } },
  });
  if (!item) return NextResponse.json({ error: "No encontrado." }, { status: 404 });
  if (item.batch.reason !== "DETERIORO" || item.resolution !== "ESCALATED_TO_PURCHASES") {
    return NextResponse.json({ error: "Este ítem no es un reclamo de deterioro escalado." }, { status: 400 });
  }
  if (item.purchaseResolution) return NextResponse.json({ error: "Este reclamo ya fue resuelto." }, { status: 409 });
  if (!item.linkedPurchaseRequestId && item.purchaseExceptionDecision !== "AUTHORIZED") {
    return NextResponse.json({ error: "Este reclamo todavía no está anclado a ninguna compra real. Elige el proveedor correcto, o repórtalo sin respaldo." }, { status: 409 });
  }

  const note = "note" in parsed.data ? parsed.data.note?.trim() || null : null;
  const now = new Date();

  // Confirmado 2026-09-23, revisión anti-fraude: un crédito menor que lo que
  // se pagó por esa mercadería necesita explicación y se le avisa al admin.
  const creditBelowExpected =
    parsed.data.resolution === "CREDIT_ISSUED" && item.expectedCreditAmount != null && parsed.data.amount < item.expectedCreditAmount - 0.01;
  if (creditBelowExpected && !note) {
    return NextResponse.json({ error: `El crédito es menor que lo que se pagó ($${item.expectedCreditAmount!.toFixed(2)}) — explica por qué en la nota.` }, { status: 400 });
  }

  await prisma.$transaction(async (tx) => {
    await tx.merchandiseOutflowItem.update({
      where: { id },
      data: {
        purchaseResolution: parsed.data.resolution,
        purchaseResolutionNote: note,
        purchaseResolvedAt: now,
        purchaseResolvedById: session.user.id,
        rejectionProofUrl: parsed.data.resolution === "REJECTED" ? parsed.data.proofUrl : null,
      },
    });

    if (parsed.data.resolution === "CREDIT_ISSUED") {
      const supplierId = item.purchaseGestionSupplierId;
      if (!supplierId) throw new Error("Falta el proveedor vinculado.");
      await tx.supplierCredit.create({
        data: {
          supplierId,
          amount: parsed.data.amount,
          reason: `Deterioro escalado — ${item.declaredName}`,
          proofUrl: parsed.data.proofUrl,
          proofName: parsed.data.proofName || null,
          status: "AVAILABLE",
          outflowItemId: id,
          createdById: session.user.id,
        },
      });
    }
  });

  await notifyInventoryLeadDeteriorPurchaseResolved({
    declaredName: outflowItemDisplayName(item),
    quantity: item.quantity,
    resolution: parsed.data.resolution,
    creditAmount: parsed.data.resolution === "CREDIT_ISSUED" ? parsed.data.amount : null,
  });

  if (parsed.data.resolution === "REJECTED" || creditBelowExpected) {
    await notifyOwner("admin", {
      title: parsed.data.resolution === "REJECTED" ? "⚠️ Proveedor rechazó un reclamo de deterioro" : "⚠️ Crédito menor a lo pagado",
      body:
        parsed.data.resolution === "REJECTED"
          ? `${outflowItemDisplayName(item)} — ${item.quantity} un.${item.expectedCreditAmount != null ? ` ($${item.expectedCreditAmount.toFixed(2)})` : ""}: ${note}`
          : `${outflowItemDisplayName(item)} — crédito $${(parsed.data as { amount: number }).amount.toFixed(2)} vs pagado $${item.expectedCreditAmount!.toFixed(2)}: ${note}`,
      url: "/area/workspace?tab=compras&ptab=urgentes",
    }).catch(() => null);
  }

  const finalItem = await prisma.merchandiseOutflowItem.findUnique({ where: { id } });
  return NextResponse.json(finalItem);
}
