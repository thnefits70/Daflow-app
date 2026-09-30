import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { canResolveSupplierStockout, dbUserId } from "@/lib/guards";

// Heidy confirma que ya lo dio de baja en Dropi (Bryan Ríos como respaldo,
// mismo permiso que "Sin stock de proveedor"). Pedido del usuario 2026-09-30.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session || !(await canResolveSupplierStockout())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  const { id } = await params;
  const sale = await prisma.dropiDiscontinuedSale.findUnique({ where: { id }, select: { code: true, delistedAt: true } });
  if (!sale) return NextResponse.json({ error: "No encontrado." }, { status: 404 });
  if (sale.delistedAt) return NextResponse.json({ error: "Ya estaba marcado como dado de baja." }, { status: 409 });
  // Se cierran juntas todas las ventas pendientes del mismo código: dar de
  // baja en Dropi es una sola acción por producto.
  await prisma.dropiDiscontinuedSale.updateMany({
    where: { code: sale.code, delistedAt: null },
    data: { delistedAt: new Date(), delistedById: dbUserId(session.user.id) },
  });
  return NextResponse.json({ ok: true });
}
