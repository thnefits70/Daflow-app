import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canManageOutflowPurchaseGestion } from "@/lib/guards";
import { notifyOwner } from "@/lib/notifications";
import { outflowItemDisplayName } from "@/lib/merchandiseOutflow";

const schema = z.discriminatedUnion("resolution", [
  z.object({
    resolution: z.literal("CREDIT_ISSUED"),
    amount: z.number().positive("El monto tiene que ser mayor a 0."),
    note: z.string().trim().min(1, "Cuenta brevemente con quién hablaste y qué acordaron."),
  }),
  z.object({
    resolution: z.literal("REJECTED"),
    note: z.string().trim().min(1, "Cuenta brevemente con quién hablaste y qué te dijo."),
    // Solo si la mercadería ya se le envió para revisión (2026-09-28).
    returnsToWarehouse: z.boolean().optional(),
  }),
]);

// Confirmado 2026-09-28, pedido explícito del usuario: CHEN no manda chats —
// arregla todo por llamada o en persona, así que Jariel no tiene captura para
// "Dio crédito"/"Rechazó el reclamo". SOLO con proveedor a crédito (hoy solo
// CHEN) puede pedirlo sin captura, con una explicación breve. El reclamo NO
// se cierra acá: queda esperando que admin lo apruebe
// (purchase-no-proof-decide/route.ts). Con los demás proveedores la captura
// sigue siendo obligatoria (purchase-resolve / purchase-credit).
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session || !(await canManageOutflowPurchaseGestion())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { id } = await params;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });

  const item = await prisma.merchandiseOutflowItem.findUnique({
    where: { id },
    include: {
      batch: { select: { reason: true } },
      catalogItem: { select: { name: true } },
      purchaseGestionSupplier: { select: { name: true, paymentMode: true } },
      exchangeItem: { select: { batch: { select: { submittedAt: true } } } },
    },
  });
  if (!item) return NextResponse.json({ error: "No encontrado." }, { status: 404 });
  if (item.batch.reason !== "DETERIORO" || item.resolution !== "ESCALATED_TO_PURCHASES") {
    return NextResponse.json({ error: "Este ítem no es un reclamo de deterioro escalado." }, { status: 400 });
  }
  if (item.purchaseResolution) return NextResponse.json({ error: "Este reclamo ya fue resuelto." }, { status: 409 });
  if (!item.linkedPurchaseRequestId && item.purchaseExceptionDecision !== "AUTHORIZED") {
    return NextResponse.json({ error: "Este reclamo todavía no está anclado a ninguna compra real. Elige el proveedor correcto, o repórtalo sin respaldo." }, { status: 409 });
  }
  if (item.purchaseGestionSupplier?.paymentMode !== "CREDITO") {
    return NextResponse.json({ error: "Solo con proveedores a crédito (Chen) se puede registrar sin captura." }, { status: 400 });
  }
  if (item.noProofRequestedAt && item.noProofDecidedAt == null) {
    return NextResponse.json({ error: "Este reclamo ya está esperando la aprobación de admin." }, { status: 409 });
  }

  const sentForInspection = !!item.exchangeItem?.batch.submittedAt;
  const returnsToWarehouse = parsed.data.resolution === "REJECTED" && sentForInspection ? parsed.data.returnsToWarehouse : undefined;
  if (parsed.data.resolution === "REJECTED" && sentForInspection && returnsToWarehouse === undefined) {
    return NextResponse.json({ error: "Indica si el proveedor devuelve la mercadería a bodega o se queda allá." }, { status: 400 });
  }

  const amount = parsed.data.resolution === "CREDIT_ISSUED" ? parsed.data.amount : null;
  await prisma.merchandiseOutflowItem.update({
    where: { id },
    data: {
      noProofResolution: parsed.data.resolution,
      noProofAmount: amount,
      noProofNote: parsed.data.note,
      noProofRequestedAt: new Date(),
      noProofRequestedById: session.user.id,
      // Si admin ya le había devuelto un pedido anterior, se empieza de cero.
      noProofApproved: null,
      noProofDecisionNote: null,
      noProofDecidedAt: null,
      noProofDecidedById: null,
      // Se guarda ya; el aviso a Daniel sale recién cuando admin aprueba.
      inspectionReturnsToWarehouse: returnsToWarehouse ?? null,
    },
  });

  const what = parsed.data.resolution === "CREDIT_ISSUED" ? `dio crédito de $${amount!.toFixed(2)}` : "rechazó el reclamo";
  await notifyOwner("admin", {
    title: "📞 Reclamo sin captura por aprobar",
    body: `${outflowItemDisplayName(item)} — ${item.quantity} un. — ${item.purchaseGestionSupplier.name} ${what}. ${session.user.name ?? "Compras"}: ${parsed.data.note}`,
    url: "/admin/deterioro-excepciones",
  }).catch(() => null);

  return NextResponse.json({ ok: true });
}
