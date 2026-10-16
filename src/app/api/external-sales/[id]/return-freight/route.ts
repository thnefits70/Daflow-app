import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { returnFreightAmount } from "@/lib/returnFreight";
import { notifyPettyCashFreightPayable } from "@/lib/externalSales";

const schema = z.object({ returnFreightCost: z.number().min(0).max(1000) });

// Pedido de Marcos 2026-10-16: el asesor dueño de la venta pone o corrige lo
// que se le debe al motorizado por la devolución, mientras no esté pagado
// (ej. devoluciones registradas antes de que existiera este dato).
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "No autorizado." }, { status: 401 });

  const { id } = await params;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Monto inválido." }, { status: 400 });

  const sale = await prisma.externalSale.findUnique({
    where: { id },
    select: { advisorId: true, kind: true, code: true, pickupPersonName: true, returnedAt: true, returnReceivedAt: true, returnFreightCost: true, freightCost: true, freightPaidAt: true, deletedAt: true },
  });
  if (!sale) return NextResponse.json({ error: "No encontrado." }, { status: 404 });
  if (sale.advisorId !== session.user.id) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  if (sale.kind !== "SALE" || !sale.returnedAt || sale.deletedAt) return NextResponse.json({ error: "Esta venta no tiene una devolución registrada." }, { status: 409 });
  if (sale.freightPaidAt) return NextResponse.json({ error: "El flete de esta devolución ya fue pagado." }, { status: 409 });

  // 0 se guarda tal cual (no se le debe nada); null quedaría en el flete declarado.
  const amount = parsed.data.returnFreightCost;
  await prisma.externalSale.update({ where: { id }, data: { returnFreightCost: amount } });

  // Si el paquete ya volvió y antes no había flete, recién ahora hay algo que pagar.
  if (amount > 0 && sale.returnReceivedAt && !(returnFreightAmount(sale) > 0)) {
    await notifyPettyCashFreightPayable({ code: sale.code, pickupPersonName: sale.pickupPersonName, freightCost: amount, excludeUserId: sale.advisorId, isReturn: true });
  }

  return NextResponse.json({ ok: true });
}
