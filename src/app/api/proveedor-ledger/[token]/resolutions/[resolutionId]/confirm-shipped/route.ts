import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { findSupplierByAnySupplierLedgerToken } from "@/lib/supplierDebt";
import { notifyOwner } from "@/lib/notifications";

// Confirmado 2026-09-24, pedido explícito del usuario: igual que
// requests/[requestId]/confirm-shipped, sin auth() — CHEN marca desde su
// enlace (saldo o solo-envíos) "ya enviamos el faltante/cambio" de una
// reposición que Jariel ya dejó acordada (REPLACEMENT PENDING). Solo es un
// aviso: nunca cambia el status — lo que cierra la reposición sigue siendo la
// recepción de Inventario + la aprobación de Daniel.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ token: string; resolutionId: string }> }) {
  const { token, resolutionId } = await params;
  const supplier = await findSupplierByAnySupplierLedgerToken(token);
  if (!supplier || supplier.paymentMode !== "CREDITO") {
    return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  }

  const resolution = await prisma.purchaseUrgentResolution.findUnique({
    where: { id: resolutionId },
    include: {
      report: { select: { request: { select: { supplierId: true, requestedById: true, catalogItem: { select: { name: true } } } } } },
    },
  });
  if (!resolution || resolution.report.request.supplierId !== supplier.id || resolution.type !== "REPLACEMENT") {
    return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  }
  if (resolution.status !== "PENDING" || resolution.supplierShippedAt) {
    return NextResponse.json({ ok: true });
  }

  await prisma.purchaseUrgentResolution.update({ where: { id: resolutionId }, data: { supplierShippedAt: new Date() } });

  const what = resolution.replacementIsMissingDelivery ? "lo faltante" : "el cambio";
  const payload = {
    title: `🚚 ${supplier.name} dice que ya envió ${what}`,
    body: `${resolution.report.request.catalogItem.name} — ${resolution.quantity} un. Registrar como ingreso cuando llegue.`,
    url: "/area/workspace",
  };
  const invLeader = await prisma.user.findFirst({ where: { isLeader: true, leadsDept: { code: "INV" } }, select: { id: true } });
  const coordinatorId = resolution.createdById ?? resolution.report.request.requestedById;
  const recipients = new Set([invLeader?.id, coordinatorId].filter((id): id is string => !!id));
  await Promise.all([...recipients].map((id) => notifyOwner(id, payload).catch(() => null)));

  return NextResponse.json({ ok: true });
}
