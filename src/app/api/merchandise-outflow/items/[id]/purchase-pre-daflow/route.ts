import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canManageOutflowPurchaseGestion, dbUserId } from "@/lib/guards";
import { findMostRecentSupplierPurchase } from "@/lib/merchandiseOutflow";
import { PRE_DAFLOW_NOTE } from "@/lib/preDaflowClaim";

// Confirmado 2026-09-30, pedido explícito del usuario: a Jariel le quitaba
// mucho tiempo reportar "sin respaldo" y esperar que admin autorice cada
// producto de CHEN comprado antes de DAFLOW. Con un clic queda autorizado a
// seguir sin compra vinculada — SOLO si el proveedor es a crédito (Chen) y
// no existe NINGUNA compra de ese producto a ese proveedor en DAFLOW (se
// vuelve a revisar acá, no se confía en la pantalla). Sin fecha de corte: si
// algún día se registra una compra, el reclamo se ancla a ella y este botón
// ya no aplica. El dinero NO se salta a admin: el crédito sin captura sigue
// pasando por purchase-no-proof-decide, donde admin ve la etiqueta.
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session || !(await canManageOutflowPurchaseGestion())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { id } = await params;
  const item = await prisma.merchandiseOutflowItem.findUnique({
    where: { id },
    include: { batch: { select: { reason: true } }, purchaseGestionSupplier: { select: { id: true, name: true, paymentMode: true } } },
  });
  if (!item) return NextResponse.json({ error: "No encontrado." }, { status: 404 });
  if (item.batch.reason !== "DETERIORO" || item.resolution !== "ESCALATED_TO_PURCHASES") {
    return NextResponse.json({ error: "Este ítem no es un reclamo de deterioro escalado." }, { status: 400 });
  }
  if (item.purchaseResolution) return NextResponse.json({ error: "Este reclamo ya fue resuelto." }, { status: 409 });
  if (item.linkedPurchaseRequestId) return NextResponse.json({ error: "Este reclamo ya está anclado a una compra real." }, { status: 409 });
  if (!item.purchaseGestionSupplier) return NextResponse.json({ error: "Elige primero un proveedor." }, { status: 400 });
  if (item.purchaseGestionSupplier.paymentMode !== "CREDITO") {
    return NextResponse.json({ error: "Solo con proveedores a crédito (Chen). Con los demás, repórtalo sin respaldo." }, { status: 400 });
  }
  if (!item.catalogItemId) return NextResponse.json({ error: "Este producto no está vinculado al catálogo." }, { status: 400 });
  if (item.purchaseNoMatchReportedAt) return NextResponse.json({ error: "Ya se reportó este reclamo." }, { status: 409 });

  const purchase = await findMostRecentSupplierPurchase(item.purchaseGestionSupplier.id, item.catalogItemId);
  if (purchase) {
    return NextResponse.json({ error: `Sí hay una compra de este producto a ${item.purchaseGestionSupplier.name} en DAFLOW. Vuelve a elegir el proveedor para anclarla.` }, { status: 409 });
  }

  const now = new Date();
  await prisma.merchandiseOutflowItem.update({
    where: { id },
    data: {
      purchaseNoMatchReportedAt: now,
      purchaseNoMatchNote: PRE_DAFLOW_NOTE,
      purchaseNoMatchReportedById: dbUserId(session.user.id),
      purchaseExceptionDecision: "AUTHORIZED",
      purchaseExceptionNote: `${PRE_DAFLOW_NOTE} — no hay ninguna compra de este producto a ${item.purchaseGestionSupplier.name} registrada. Lo marcó ${session.user.name ?? "Compras"}.`,
      purchaseExceptionDecidedAt: now,
      purchaseExceptionDecidedById: null,
    },
  });

  return NextResponse.json({ ok: true });
}
