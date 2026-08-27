import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canConfirmSupplierExchangeFinanceWriteOff } from "@/lib/guards";

// Confirmado 2026-08-27, pedido explícito del usuario: cuando un ítem de
// "Cambio con proveedor" quedó REJECTED (el proveedor no cambia ni da
// crédito), Nairoby confirma acá que ya registró la pérdida en la parte
// financiera — queda como una tarea separada de la de Daniel (ver
// just-writeoff-confirm), cada una con su propio responsable.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session || !(await canConfirmSupplierExchangeFinanceWriteOff())) {
    return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  }

  const { id } = await params;
  const item = await prisma.merchandiseOutflowItem.findUnique({ where: { id }, select: { resolution: true, financeWriteOffAt: true } });
  if (!item) return NextResponse.json({ error: "No encontrado." }, { status: 404 });
  if (item.resolution !== "REJECTED") return NextResponse.json({ error: "Este ítem no fue rechazado por el proveedor." }, { status: 400 });
  if (item.financeWriteOffAt) return NextResponse.json({ error: "Ya se confirmó la baja financiera." }, { status: 409 });

  const updated = await prisma.merchandiseOutflowItem.update({
    where: { id },
    data: { financeWriteOffAt: new Date(), financeWriteOffById: session.user.id },
  });
  return NextResponse.json(updated);
}
