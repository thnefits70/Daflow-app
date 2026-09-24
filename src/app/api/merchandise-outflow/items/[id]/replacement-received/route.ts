import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canActOnMerchandiseOutflow, getFinanceLeadId, getPurchaseGestionManagerId } from "@/lib/guards";
import { outflowItemDisplayName } from "@/lib/merchandiseOutflow";
import { notifyOwner } from "@/lib/notifications";
import { recordKardexEntry } from "@/lib/stockKardex";

const schema = z.object({
  quantity: z.number().int().positive(),
  photoUrls: z.array(z.string().url()).min(1, "Toma al menos una foto del reemplazo que llegó.").max(4),
  note: z.string().trim().max(1000).optional(),
});

// Confirmado 2026-09-24, pedido de Nairoby: un cambio con el proveedor
// (REPLACED) ya no se da por cerrado cuando el proveedor dice que sí — se
// cierra cuando Daniel confirma con foto que llegó el reemplazo en buen
// estado. Cada llegada suma esas unidades al Kardex (al costo que se pagó
// en la compra original; el proveedor no cobra el reemplazo). Puede llegar
// en partes: si llega menos de lo acordado, avisa a Nairoby y a Jariel, y el
// resto sigue pendiente.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session || !(await canActOnMerchandiseOutflow())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { id } = await params;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });

  const item = await prisma.merchandiseOutflowItem.findUnique({
    where: { id },
    include: {
      batch: { select: { reason: true, submittedAt: true, code: true, supplier: { select: { name: true } } } },
      catalogItem: { select: { name: true } },
      replacementReceipts: { select: { quantity: true } },
    },
  });
  if (!item) return NextResponse.json({ error: "No encontrado." }, { status: 404 });
  if (item.batch.reason !== "CAMBIO_PROVEEDOR" || !item.batch.submittedAt || item.resolution !== "REPLACED") {
    return NextResponse.json({ error: "Solo se registra la llegada de un cambio ya aceptado por el proveedor y enviado." }, { status: 400 });
  }
  if (item.replacementReceivedAt) return NextResponse.json({ error: "El reemplazo ya llegó completo." }, { status: 409 });

  const alreadyReceived = item.replacementReceipts.reduce((sum, r) => sum + r.quantity, 0);
  const missing = item.quantity - alreadyReceived;
  if (parsed.data.quantity > missing) return NextResponse.json({ error: `Solo faltan ${missing} un. por llegar.` }, { status: 400 });
  const note = parsed.data.note?.trim() || null;
  const stillMissing = missing - parsed.data.quantity;
  if (stillMissing > 0 && !note) return NextResponse.json({ error: `Llegaron menos de las que faltan (${missing}) — explica qué dijo el proveedor del resto.` }, { status: 400 });

  const now = new Date();
  const ok = await prisma
    .$transaction(async (tx) => {
    // Candado: si otra pestaña ya cerró el ítem, no se suma dos veces.
    const locked = await tx.merchandiseOutflowItem.updateMany({
      where: { id, replacementReceivedAt: null },
      data: { replacementReceivedAt: stillMissing === 0 ? now : null },
    });
    if (locked.count === 0) return false;
    const sum = await tx.merchandiseReplacementReceipt.aggregate({ where: { outflowItemId: id }, _sum: { quantity: true } });
    if ((sum._sum.quantity ?? 0) !== alreadyReceived) throw new Error("changed");
    await tx.merchandiseReplacementReceipt.create({
      data: { outflowItemId: id, quantity: parsed.data.quantity, photoUrls: parsed.data.photoUrls, note, receivedById: session.user.id, receivedAt: now },
    });
    return true;
  })
    .catch(() => false);
  if (!ok) return NextResponse.json({ error: "El reemplazo ya llegó completo." }, { status: 409 });

  if (item.catalogItemId) {
    await recordKardexEntry({ catalogItemId: item.catalogItemId, type: "IN", quantity: parsed.data.quantity, unitCost: item.unitCostAtExchange, occurredAt: now }).catch((err) =>
      console.error("[replacement-received] No se pudo registrar la entrada de Kardex:", err)
    );
  }

  if (stillMissing > 0) {
    const [financeLeadId, gestionId] = await Promise.all([getFinanceLeadId(), getPurchaseGestionManagerId()]);
    const body = `${outflowItemDisplayName(item)} (${item.batch.code}, ${item.batch.supplier?.name ?? "proveedor"}) — llegaron ${parsed.data.quantity} de ${missing}, faltan ${stillMissing}. ${note}`;
    for (const uid of new Set([financeLeadId, gestionId].filter(Boolean) as string[])) {
      await notifyOwner(uid, { title: "⚠️ El reemplazo llegó incompleto", body, url: "/area/workspace?tab=egresos&otab=proveedor" }).catch(() => null);
    }
  }

  return NextResponse.json({ ok: true, stillMissing });
}
