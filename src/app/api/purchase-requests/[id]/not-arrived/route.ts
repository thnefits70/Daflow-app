import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { canReceivePurchasesTeam, canActOnPurchaseReceiving } from "@/lib/guards";
import { notifyOwner } from "@/lib/notifications";
import { LEFT_BEHIND_HREF } from "@/lib/purchases";
import { getLinesToConfirm, resolveInventoryLinesToConfirm } from "@/lib/purchaseLeftBehind";

// Pedido de Jariel 2026-10-05: Inventario confirma que un producto no llegó
// con el resto del pedido. Se abre el reclamo por todo lo pedido, ya revisado
// (no hay nada contado que Daniel tenga que revisar), y se avisa al instante
// a quien compró para que acuerde con el proveedor desde Reportes urgentes:
// que llegue otro día, crédito a favor o devolución del dinero.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session || (!(await canReceivePurchasesTeam()) && !(await canActOnPurchaseReceiving()))) {
    return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  }

  const { id } = await params;
  const line = (await getLinesToConfirm()).find((l) => l.id === id);
  if (!line) {
    return NextResponse.json({ error: "Este producto ya se registró o ya tiene un reporte." }, { status: 409 });
  }

  const now = new Date();
  const report = await prisma.purchaseRequestUrgentReport.create({
    data: {
      requestId: id,
      missingQty: line.quantity,
      description: "No llegó con el resto del pedido (confirmado por Inventario).",
      mediaUrls: [],
      reportedById: session.user.role === "admin" ? null : session.user.id,
      reviewedByLeadAt: now,
    },
  });

  if (line.requestedById) {
    await notifyOwner(line.requestedById, {
      title: "🚨 Mercadería no recibida — coordina con el proveedor",
      body: `${line.name} (${line.quantity} un.) · ${line.supplierName} — Inventario confirmó que no llegó con el resto del pedido. Acuerda si llega otro día, crédito a favor o devolución del dinero.`,
      url: LEFT_BEHIND_HREF,
    }).catch(() => null);
  }
  await resolveInventoryLinesToConfirm(line.groupId, line.supplierName).catch(() => null);

  return NextResponse.json(report, { status: 201 });
}
