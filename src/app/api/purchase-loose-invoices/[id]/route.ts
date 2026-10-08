import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { canActOnPurchaseInvoices } from "@/lib/guards";

// Quitar una factura sin compra específica subida por error — se oculta, no
// se borra, con rastro de quién y cuándo.
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!(await canActOnPurchaseInvoices()) || !session) return NextResponse.json({ error: "Exclusivo de Nairoby (líder de Finanzas)." }, { status: 403 });
  const { id } = await params;
  const row = await prisma.looseInvoice.findUnique({ where: { id }, select: { deletedAt: true } });
  if (!row || row.deletedAt) return NextResponse.json({ error: "No encontrada." }, { status: 404 });
  await prisma.looseInvoice.update({ where: { id }, data: { deletedAt: new Date(), deletedById: session.user.id } });
  return NextResponse.json({ ok: true });
}
