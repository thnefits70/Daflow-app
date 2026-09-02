import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { sendPushToOwner } from "@/lib/webPush";

// Solo admin — es quien de verdad revisa su cuenta bancaria. El doble
// "¿estás seguro?" vive en el cliente (pantalla de confirmación con los
// valores antes de este POST); desde que confirma, el reembolso queda bajo
// su responsabilidad.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session || session.user.role !== "admin") return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { id } = await params;
  const resolution = await prisma.purchaseUrgentResolution.findUnique({
    where: { id },
    include: { report: { include: { request: { select: { catalogItem: { select: { name: true } } } } } } },
  });
  if (!resolution || resolution.type !== "REFUND") return NextResponse.json({ error: "No encontrada." }, { status: 404 });
  if (!resolution.refundAiMatch) return NextResponse.json({ error: "Todavía no hay un comprobante verificado." }, { status: 409 });
  if (resolution.status !== "PENDING") return NextResponse.json({ error: "Ya fue confirmado." }, { status: 409 });

  const updated = await prisma.purchaseUrgentResolution.update({
    where: { id },
    data: { status: "COMPLETED", bankConfirmedAt: new Date(), bankConfirmedById: session.user.id },
  });

  // Confirmado 2026-09-02: pedido explícito de Bryan — quien coordinó el
  // reembolso con el proveedor (createdById) no se enteraba de que admin ya
  // revisó su banco y cerró la operación. Sin esto, el mismo Bryan tenía que
  // volver a preguntar si el dinero había llegado.
  if (resolution.createdById) {
    await sendPushToOwner(resolution.createdById, {
      title: "✅ Reembolso cerrado — el dinero sí llegó",
      body: `${resolution.report.request.catalogItem.name} — $${resolution.amount.toFixed(2)} confirmado en el banco`,
      url: "/area/workspace",
    }).catch(() => null);
  }

  return NextResponse.json(updated);
}
