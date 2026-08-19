import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canConfirmPersonalPurchaseInventory } from "@/lib/guards";

// Solo trazabilidad — no afecta ningún cálculo de nómina.
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await canConfirmPersonalPurchaseInventory())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { id } = await params;
  const updated = await prisma.personalPurchaseOrder.update({ where: { id }, data: { pickedUpAt: new Date() } });
  return NextResponse.json(updated);
}
