import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canActOnMerchandiseOutflow } from "@/lib/guards";

// Confirmado 2026-09-28 (pedido de Jariel, opción "depende" del usuario): el
// proveedor revisó la mercadería, rechazó el reclamo y la devolvió — Daniel
// confirma que regresó a bodega. No toca Kardex: sigue siendo mercadería
// dañada, ya salió del stock cuando se reportó el deterioro.
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session || !(await canActOnMerchandiseOutflow())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { id } = await params;
  const item = await prisma.merchandiseOutflowItem.findUnique({
    where: { id },
    select: { purchaseResolution: true, inspectionReturnsToWarehouse: true, inspectionReturnReceivedAt: true },
  });
  if (!item) return NextResponse.json({ error: "No encontrado." }, { status: 404 });
  if (item.purchaseResolution !== "REJECTED" || !item.inspectionReturnsToWarehouse) {
    return NextResponse.json({ error: "Este producto no tiene que regresar del proveedor." }, { status: 400 });
  }
  if (item.inspectionReturnReceivedAt) return NextResponse.json({ error: "Ya se confirmó que regresó." }, { status: 409 });

  await prisma.merchandiseOutflowItem.update({
    where: { id },
    data: { inspectionReturnReceivedAt: new Date(), inspectionReturnReceivedById: session.user.id },
  });
  return NextResponse.json({ ok: true });
}
