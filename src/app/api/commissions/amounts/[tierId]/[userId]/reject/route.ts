import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canApproveCommissionAmounts } from "@/lib/guards";

export async function POST(_req: Request, { params }: { params: Promise<{ tierId: string; userId: string }> }) {
  if (!(await canApproveCommissionAmounts())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { tierId, userId } = await params;
  const updated = await prisma.commissionTierAmount.update({
    where: { tierId_userId: { tierId, userId } },
    data: { pendingAmount: null },
  });
  return NextResponse.json(updated);
}
