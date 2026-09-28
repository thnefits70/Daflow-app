import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canManageOutflowPurchaseGestion, getInventoryLeadId } from "@/lib/guards";
import { notifyOwner } from "@/lib/notifications";
import { outflowItemDisplayName } from "@/lib/merchandiseOutflow";

const schema = z.object({ note: z.string().trim().optional() });

// Confirmado 2026-09-28, pedido de Jariel (sí del usuario): los proveedores
// quieren REVISAR la mercadería antes de dar cambio, crédito o rechazo.
// Jariel lo marca acá y Daniel recibe el aviso para armar el paquete de
// revisión (to-exchange lo permite aunque todavía no haya resolución). El
// reclamo sigue abierto: Jariel resuelve igual que siempre cuando el
// proveedor responda, y esa respuesta se copia al paquete.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session || !(await canManageOutflowPurchaseGestion())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { id } = await params;
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });

  const item = await prisma.merchandiseOutflowItem.findUnique({
    where: { id },
    include: { batch: { select: { reason: true } }, catalogItem: { select: { name: true } }, purchaseGestionSupplier: { select: { name: true } } },
  });
  if (!item) return NextResponse.json({ error: "No encontrado." }, { status: 404 });
  if (item.batch.reason !== "DETERIORO" || item.resolution !== "ESCALATED_TO_PURCHASES") {
    return NextResponse.json({ error: "Este ítem no es un reclamo de deterioro escalado." }, { status: 400 });
  }
  if (item.purchaseResolution) return NextResponse.json({ error: "Este reclamo ya fue resuelto." }, { status: 409 });
  if (!item.purchaseGestionSupplier) return NextResponse.json({ error: "Primero confirma el proveedor." }, { status: 409 });
  if (item.supplierInspectionRequestedAt) return NextResponse.json({ error: "Ya pediste que Daniel la envíe para revisión." }, { status: 409 });

  const note = parsed.data.note || null;
  await prisma.merchandiseOutflowItem.update({
    where: { id },
    data: { supplierInspectionRequestedAt: new Date(), supplierInspectionRequestedById: session.user.id, supplierInspectionNote: note },
  });

  const leadId = await getInventoryLeadId();
  if (leadId) {
    await notifyOwner(leadId, {
      title: "📦 Enviar mercadería para revisión del proveedor",
      body: `${outflowItemDisplayName(item)} — ${item.quantity} un.: ${item.purchaseGestionSupplier.name} quiere revisarla antes de decidir. Arma el paquete.${note ? ` Nota: ${note}` : ""}`,
      url: "/area/workspace?tab=egresos&otab=seguimiento",
    }).catch(() => null);
  }

  return NextResponse.json({ ok: true });
}
