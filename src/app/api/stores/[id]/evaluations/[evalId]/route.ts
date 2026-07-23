import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canManageStoreFeedback } from "@/lib/guards";

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string; evalId: string }> }) {
  if (!(await canManageStoreFeedback())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { id, evalId } = await params;
  await prisma.storeFeedbackEvaluation.deleteMany({ where: { id: evalId, storeId: id } });
  return NextResponse.json({ ok: true });
}
