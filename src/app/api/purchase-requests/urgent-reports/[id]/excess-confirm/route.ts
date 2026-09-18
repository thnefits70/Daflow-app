import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canActOnPurchaseApproval, getInventoryLeadId } from "@/lib/guards";
import { notifyOwner } from "@/lib/notifications";
import { auth } from "@/auth";

// Confirmado 2026-09-17: pedido explícito del usuario — confirmación FINAL
// de que el excedente (llegó más de lo pedido) es real, exclusiva de Bryan
// (mismo criterio que canActOnPurchaseApproval en el resto de Compras — ni
// siquiera admin). Requiere que Jariel ya haya dejado constancia de la
// gestión con el proveedor (ver excess-gestion/route.ts). Solo después de
// esto, "Confirmar que llegó" puede incluir el excedente (ver
// receipt/route.ts y goodQuantity() en PurchaseReceivingPanel.tsx) — recién
// ahí el Kardex de INVESTOCK suma esas unidades.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!(await canActOnPurchaseApproval()) || !session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { id } = await params;
  const existing = await prisma.purchaseRequestUrgentReport.findUnique({
    where: { id },
    include: { request: { select: { catalogItem: { select: { name: true } } } } },
  });
  if (!existing) return NextResponse.json({ error: "No encontrado." }, { status: 404 });
  if (existing.excessQty <= 0) return NextResponse.json({ error: "Este reporte no tiene excedente." }, { status: 409 });
  if (!existing.excessGestionAt) return NextResponse.json({ error: "Falta que se gestione con el proveedor primero." }, { status: 409 });
  if (existing.excessConfirmedAt) return NextResponse.json({ error: "Ya fue confirmado." }, { status: 409 });

  const updated = await prisma.purchaseRequestUrgentReport.update({
    where: { id },
    data: { excessConfirmedById: session.user.id, excessConfirmedAt: new Date() },
  });

  const leadId = await getInventoryLeadId();
  if (leadId) {
    await notifyOwner(leadId, {
      title: "✅ Excedente confirmado — ya se puede recibir",
      body: `${existing.request.catalogItem.name} — las ${existing.excessQty} un. de más ya están confirmadas, tu equipo ya puede usar 'Confirmar que llegó' con el total.`,
      url: "/area/workspace?tab=compras&ptab=inventario",
    }).catch(() => null);
  }

  return NextResponse.json(updated);
}
