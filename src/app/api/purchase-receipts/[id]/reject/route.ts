import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdminSession } from "@/lib/guards";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await requireAdminSession())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  const { id } = await params;

  await prisma.purchaseReceiptChangeRequest.deleteMany({ where: { receiptId: id } });
  return NextResponse.json({ ok: true });
}
