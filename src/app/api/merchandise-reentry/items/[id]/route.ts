import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canCaptureMerchandiseReentry, canActOnMerchandiseReentry } from "@/lib/guards";
import { notifyOwner } from "@/lib/notifications";

// Quitar un producto agregado por error — mientras el lote sigue en
// borrador, lo hace quien lo capturó. Una vez enviado, solo Daniel (líder de
// Inventario, canActOnMerchandiseReentry) puede quitar un ítem, y solo si
// todavía no fue aprobado.
// Pedido de Daniel 2026-10-13: también desde "Requiere revisión" (p.ej. un
// producto de ALF, que no se inventaría). Con el lote ya enviado, DAFLOW le
// pregunta "por qué" y el motivo le llega al admin como notificación.
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { id } = await params;
  const item = await prisma.merchandiseReentryItem.findUnique({
    where: { id },
    select: {
      approvedAt: true,
      declaredName: true,
      correctedName: true,
      goodQty: true,
      damagedQty: true,
      catalogItem: { select: { name: true } },
      batch: { select: { code: true, createdById: true, submittedAt: true, createdBy: { select: { name: true } } } },
    },
  });
  if (!item) return NextResponse.json({ error: "No encontrado." }, { status: 404 });

  let reason = "";
  if (!item.batch.submittedAt) {
    if (!(await canCaptureMerchandiseReentry()) || item.batch.createdById !== session.user.id) {
      return NextResponse.json({ error: "No autorizado." }, { status: 403 });
    }
  } else {
    if (!(await canActOnMerchandiseReentry())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
    if (item.approvedAt) return NextResponse.json({ error: "Este producto ya fue aprobado — no se puede quitar." }, { status: 409 });
    const body = await req.json().catch(() => null);
    reason = typeof body?.reason === "string" ? body.reason.trim() : "";
    if (reason.length < 3) return NextResponse.json({ error: "Escribe por qué lo eliminas." }, { status: 400 });
  }

  await prisma.merchandiseReentryItem.delete({ where: { id } });

  if (item.batch.submittedAt) {
    const name = item.correctedName ?? item.catalogItem?.name ?? item.declaredName ?? "Producto sin nombre";
    const units = item.goodQty + item.damagedQty;
    await notifyOwner("admin", {
      title: "Reingreso de mercadería: producto eliminado",
      body: `${session.user.name ?? "Inventario"} eliminó "${name}" (${units} un.) del lote ${item.batch.code}${item.batch.createdBy?.name ? ` de ${item.batch.createdBy.name}` : ""}. Motivo: ${reason}`,
      url: "/area/reingreso-mercaderia?tab=revision",
    }).catch((err) => console.error("[reentry delete] aviso al admin:", err));
  }

  return NextResponse.json({ ok: true });
}
