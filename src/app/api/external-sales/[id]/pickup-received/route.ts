import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canCaptureMerchandiseOutflow, dbUserId } from "@/lib/guards";
import { notifyOwner } from "@/lib/notifications";

// Pedido del usuario 2026-10-02: lo que el motorizado recoge en una garantía
// local (dañado, mandado por error o de más) vuelve a bodega y alguien de
// Inventario confirma que llegó. No mueve el stock: lo dañado ya se descontó
// en el corte original y lo equivocado/de más nunca se descontó. Recién con
// esto el asesor puede cerrar la garantía y se habilita el pago del flete.
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!(await canCaptureMerchandiseOutflow()) || !session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  const { id } = await params;
  const sale = await prisma.externalSale.findUnique({
    where: { id },
    select: { kind: true, code: true, advisorId: true, deliveredAt: true, deletedAt: true, items: { where: { warrantyRole: "PICKUP", pickupReceivedAt: null }, select: { id: true } } },
  });
  if (!sale || sale.kind !== "WARRANTY") return NextResponse.json({ error: "No encontrado." }, { status: 404 });
  if (sale.deletedAt) return NextResponse.json({ error: "Esta garantía fue cancelada." }, { status: 409 });
  if (!sale.deliveredAt) return NextResponse.json({ error: "El motorizado todavía no sale con esta garantía." }, { status: 409 });
  if (sale.items.length === 0) return NextResponse.json({ error: "Ya se confirmó todo lo que había que recoger." }, { status: 409 });

  await prisma.externalSaleItem.updateMany({
    where: { id: { in: sale.items.map((i) => i.id) }, pickupReceivedAt: null },
    data: { pickupReceivedAt: new Date(), pickupReceivedById: dbUserId(session.user.id) },
  });
  await notifyOwner(sale.advisorId, {
    title: "📦 Bodega recibió lo que trajo el motorizado",
    body: `${sale.code} — ya puedes cerrar la garantía para que se pague el flete.`,
    url: "/area/workspace?tab=ventas-externas&etab=garantias",
  }).catch(() => null);
  return NextResponse.json({ ok: true });
}
