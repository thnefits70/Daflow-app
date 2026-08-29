import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canActOnMerchandiseOutflow } from "@/lib/guards";

export async function GET() {
  if (!(await canActOnMerchandiseOutflow())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  const reports = await prisma.cancelledGuideReport.findMany({
    where: { reallyCancelled: true, reingresadoAt: null },
    include: { items: { include: { catalogItem: { select: { name: true, justCode: true } } } } },
    orderBy: { cutoffDecidedAt: "asc" },
  });
  return NextResponse.json(reports);
}
