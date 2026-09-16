import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canCaptureMerchandiseOutflow } from "@/lib/guards";
import { notifyInventoryLeadExternalSaleReturnReceived } from "@/lib/externalSales";

const schema = z.object({ note: z.string().trim().max(500).optional() });

// Confirmado 2026-09-16, pedido explícito del usuario: mismo equipo que ya
// recibe mercadería de Compras (canCaptureMerchandiseOutflow) verifica
// físicamente que el paquete devuelto llegó completo — todavía NO suma a
// INVESTOCK, falta la aprobación de Daniel (ver return-confirm/).
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!(await canCaptureMerchandiseOutflow()) || !session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { id } = await params;
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body ?? {});
  if (!parsed.success) return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });

  const sale = await prisma.externalSale.findUnique({
    where: { id },
    select: { returnedAt: true, returnReceivedAt: true, code: true },
  });
  if (!sale) return NextResponse.json({ error: "No encontrado." }, { status: 404 });
  if (!sale.returnedAt) return NextResponse.json({ error: "Esta venta no fue reportada como devuelta." }, { status: 409 });
  if (sale.returnReceivedAt) return NextResponse.json({ error: "Ya se registró la recepción física." }, { status: 409 });

  const updated = await prisma.externalSale.update({
    where: { id },
    data: { returnReceivedAt: new Date(), returnReceivedById: session.user.id, returnReceivedNote: parsed.data.note || null },
  });

  await notifyInventoryLeadExternalSaleReturnReceived(sale.code);

  return NextResponse.json(updated);
}
