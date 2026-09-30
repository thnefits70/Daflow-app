import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canAssignExternalSalePack } from "@/lib/guards";

// Pedido de Yair 2026-09-30: al tocar "Ver / imprimir guía" en el tablero de
// Fulfillment la venta queda marcada "Ya impreso" (con quién y cuándo), para
// ver de un vistazo qué guías ya salieron. Reimprimir solo actualiza la fecha.
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session || !(await canAssignExternalSalePack())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { id } = await params;
  const sale = await prisma.externalSale.findUnique({ where: { id }, select: { id: true } });
  if (!sale) return NextResponse.json({ error: "No encontrado." }, { status: 404 });

  const updated = await prisma.externalSale.update({
    where: { id },
    data: { guidePrintedAt: new Date(), guidePrintedById: session.user.role === "admin" ? null : session.user.id },
    select: { guidePrintedAt: true, guidePrintedBy: { select: { name: true } } },
  });
  return NextResponse.json(updated);
}
