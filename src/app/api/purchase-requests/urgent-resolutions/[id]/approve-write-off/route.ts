import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { notifyOwner } from "@/lib/notifications";

// Confirmado 2026-09-29, pedido del usuario (antifraude): una "Pérdida"
// que pide Compras queda PENDING hasta que el admin la aprueba — recién ahí
// cuenta como resuelta (y el pedido se puede pagar). Rechazar = cancelar
// con motivo (urgent-resolutions/[id]/cancel), la cantidad vuelve a quedar
// libre para resolverla con crédito o entrega de faltante.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (session?.user.role !== "admin") return NextResponse.json({ error: "Solo el admin aprueba una pérdida." }, { status: 403 });

  const { id } = await params;
  const updated = await prisma.purchaseUrgentResolution.updateMany({
    where: { id, type: "WRITE_OFF", status: "PENDING" },
    data: { status: "COMPLETED" },
  });
  if (updated.count === 0) return NextResponse.json({ error: "Esta pérdida ya fue revisada." }, { status: 409 });

  const res = await prisma.purchaseUrgentResolution.findUnique({
    where: { id },
    select: { quantity: true, createdById: true, report: { select: { request: { select: { catalogItem: { select: { name: true } } } } } } },
  });
  if (res?.createdById) {
    await notifyOwner(res.createdById, {
      title: "Pérdida aprobada por el admin",
      body: `${res.report.request.catalogItem.name} — ${res.quantity} un.`,
      url: "/area/workspace",
    }).catch(() => null);
  }
  return NextResponse.json({ ok: true });
}
