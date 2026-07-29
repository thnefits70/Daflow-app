import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canSubmitPurchaseRequests } from "@/lib/guards";
import { getCatalogItemPriceStats } from "@/lib/purchases";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await canSubmitPurchaseRequests())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { id } = await params;
  const item = await prisma.purchaseCatalogItem.findUnique({ where: { id } });
  if (!item) return NextResponse.json({ error: "No encontrado." }, { status: 404 });

  const stats = await getCatalogItemPriceStats(id);
  return NextResponse.json({ id: item.id, name: item.name, photos: item.photos, stats });
}
