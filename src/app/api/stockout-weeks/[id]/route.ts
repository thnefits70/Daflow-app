import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canManageStockouts } from "@/lib/guards";

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const canManage = await canManageStockouts();
  if (!canManage) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { id } = await params;
  await prisma.stockoutWeekProduct.delete({ where: { id } }).catch(() => null);
  return NextResponse.json({ ok: true });
}
