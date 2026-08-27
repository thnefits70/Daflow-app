import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canActOnMerchandiseOutflow } from "@/lib/guards";

// Confirmado 2026-08-27, pedido explícito del usuario: cuando un ítem de
// "Cambio con proveedor" quedó REJECTED (el proveedor no cambia ni da
// crédito), Daniel confirma acá que ya dio de baja esa mercadería en el
// sistema Just — tarea separada de la de Nairoby (ver finance-writeoff),
// cada una con su propio responsable. Reusa canActOnMerchandiseOutflow
// (exclusivo de Daniel, ni admin) porque es el mismo criterio que ya usa
// el resto de "dar de baja" de este módulo.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session || !(await canActOnMerchandiseOutflow())) {
    return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  }

  const { id } = await params;
  const item = await prisma.merchandiseOutflowItem.findUnique({ where: { id }, select: { resolution: true, justWriteOffConfirmedAt: true } });
  if (!item) return NextResponse.json({ error: "No encontrado." }, { status: 404 });
  if (item.resolution !== "REJECTED") return NextResponse.json({ error: "Este ítem no fue rechazado por el proveedor." }, { status: 400 });
  if (item.justWriteOffConfirmedAt) return NextResponse.json({ error: "Ya se confirmó la baja en Just." }, { status: 409 });

  const updated = await prisma.merchandiseOutflowItem.update({
    where: { id },
    data: { justWriteOffConfirmedAt: new Date(), justWriteOffConfirmedById: session.user.id },
  });
  return NextResponse.json(updated);
}
