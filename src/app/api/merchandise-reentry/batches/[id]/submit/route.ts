import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canCaptureMerchandiseReentry, getInventoryLeadId } from "@/lib/guards";
import { sendPushToOwner } from "@/lib/webPush";

// La doble confirmación ("¿Estás seguro?" Sí/No) vive del lado del cliente
// — esta ruta es el único Sí que de verdad congela el lote. A partir de acá
// ni el colaborador puede seguir editando.
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!(await canCaptureMerchandiseReentry()) || !session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { id } = await params;
  const batch = await prisma.merchandiseReentryBatch.findUnique({
    where: { id },
    include: { items: { select: { id: true } } },
  });
  if (!batch) return NextResponse.json({ error: "Lote no encontrado." }, { status: 404 });
  if (batch.createdById !== session.user.id) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  if (batch.submittedAt) return NextResponse.json({ error: "Este lote ya fue enviado." }, { status: 409 });
  if (batch.items.length === 0) return NextResponse.json({ error: "Agrega al menos un producto antes de enviar." }, { status: 409 });

  const updated = await prisma.merchandiseReentryBatch.update({
    where: { id },
    data: { submittedAt: new Date() },
  });

  const leadId = await getInventoryLeadId();
  if (leadId) {
    await sendPushToOwner(leadId, {
      title: "Reingreso de mercadería pendiente de tu revisión",
      body: `${batch.code} — ${batch.items.length} producto(s) enviados por ${session.user.name ?? "un colaborador"}.`,
      url: "/area/reingreso-mercaderia?tab=revision",
    }).catch(() => null);
  }

  return NextResponse.json(updated);
}
