import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdminSession } from "@/lib/guards";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireAdminSession();
  if (!session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { id } = await params;
  const users = await prisma.user.findMany({
    where: { deptId: id },
    orderBy: { name: "asc" },
    select: { id: true, name: true, username: true, position: true },
  });
  return NextResponse.json(users);
}
