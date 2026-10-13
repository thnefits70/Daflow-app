import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { canReceivePurchasesTeam, canActOnPurchaseReceiving, getPurchaseApproverIds } from "@/lib/guards";
import { notifyOwner } from "@/lib/notifications";
import { LEFT_BEHIND_HREF } from "@/lib/purchases";
import { getLinesToConfirm, resolveInventoryLinesToConfirm } from "@/lib/purchaseLeftBehind";
import { formatPurchaseRequestCode } from "@/lib/purchases";

// Pedido de Daniel 2026-10-13: en un pedido de UN solo producto no hay "lo
// demás ya llegó" que dispare la confirmación — Daniel (y solo él) puede
// marcar igual que no llegó. Mismas condiciones que getLinesToConfirm,
// menos lo del resto del pedido.
async function getSingleProductLine(id: string) {
  const r = await prisma.purchaseRequest.findFirst({
    where: {
      id,
      receipt: null,
      urgentReports: { none: {} },
      OR: [{ status: "PAID" }, { status: "APPROVED", supplier: { paymentMode: "CREDITO" } }],
    },
    select: { id: true, groupId: true, requestNumber: true, quantity: true, requestedById: true, requestedBy: { select: { name: true } }, catalogItem: { select: { name: true } }, supplier: { select: { name: true } } },
  });
  if (!r) return null;
  if ((await prisma.purchaseRequest.count({ where: { groupId: r.groupId } })) !== 1) return null;
  return {
    id: r.id,
    groupId: r.groupId,
    code: r.requestNumber ? formatPurchaseRequestCode(r.requestNumber) : null,
    name: r.catalogItem.name,
    quantity: r.quantity,
    supplierName: r.supplier?.name ?? "proveedor",
    requestedById: r.requestedById,
    requestedByName: r.requestedBy?.name ?? null,
  };
}

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
  let line: Awaited<ReturnType<typeof getSingleProductLine>> = (await getLinesToConfirm()).find((l) => l.id === id) ?? null;
  const single = !line && (await canActOnPurchaseReceiving());
  if (single) line = await getSingleProductLine(id);
  if (!line) {
    return NextResponse.json({ error: "Este producto ya se registró o ya tiene un reporte." }, { status: 409 });
  }

  // Pedido del usuario 2026-10-13 (SC-177, máquina de coser): el aviso no
  // decía el código de la compra y Jariel no lo relacionó con su pedido.
  const codePrefix = line.code ? `${line.code} · ` : "";

  const now = new Date();
  const report = await prisma.purchaseRequestUrgentReport.create({
    data: {
      requestId: id,
      missingQty: line.quantity,
      description: single ? "No llegó (pedido de un solo producto, confirmado por el líder de Inventario)." : "No llegó con el resto del pedido (confirmado por Inventario).",
      mediaUrls: [],
      reportedById: session.user.role === "admin" ? null : session.user.id,
      reviewedByLeadAt: now,
    },
  });

  if (line.requestedById) {
    await notifyOwner(line.requestedById, {
      title: "🚨 Mercadería no recibida — coordina con el proveedor",
      body: `${codePrefix}${line.name} (${line.quantity} un.) · ${line.supplierName} — Inventario confirmó que no llegó${single ? "" : " con el resto del pedido"}. Acuerda si llega otro día, crédito a favor o devolución del dinero.`,
      url: LEFT_BEHIND_HREF,
    }).catch(() => null);
  }
  // Pedido del usuario 2026-10-05: Bryan (quien aprueba compras) no gestiona
  // nada de esto, pero debe quedar enterado — solo aviso.
  for (const approverId of await getPurchaseApproverIds()) {
    if (approverId === line.requestedById) continue;
    await notifyOwner(approverId, {
      title: "📦 Mercadería no recibida (solo aviso)",
      body: `${codePrefix}${line.name} (${line.quantity} un.) · ${line.supplierName} — Inventario confirmó que no llegó${single ? "" : " con el resto del pedido"}. ${line.requestedByName ?? "Compras"} lo coordina con el proveedor.`,
      url: LEFT_BEHIND_HREF,
    }).catch(() => null);
  }
  await resolveInventoryLinesToConfirm(line.groupId, line.supplierName).catch(() => null);

  return NextResponse.json(report, { status: 201 });
}
