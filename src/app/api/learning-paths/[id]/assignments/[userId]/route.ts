import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdminSession } from "@/lib/guards";

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string; userId: string }> }) {
  const session = await requireAdminSession();
  if (!session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { id, userId } = await params;
  await prisma.learningPathAssignment.delete({ where: { pathId_userId: { pathId: id, userId } } }).catch(() => null);
  return NextResponse.json({ ok: true });
}
