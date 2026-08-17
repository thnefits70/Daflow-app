import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canApproveFixedMonthlyBonus } from "@/lib/guards";

export async function POST(_req: Request, { params }: { params: Promise<{ userId: string }> }) {
  if (!(await canApproveFixedMonthlyBonus())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { userId } = await params;
  const updated = await prisma.fixedMonthlyBonus.update({
    where: { userId },
    data: { pendingAmount: null },
  });
  return NextResponse.json(updated);
}
