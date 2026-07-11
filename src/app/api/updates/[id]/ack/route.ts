import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session || session.user.role !== "employee") {
    return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  }

  const { id } = await params;
  await prisma.userAckUpdate.upsert({
    where: { userId_updateId: { userId: session.user.id, updateId: id } },
    update: {},
    create: { userId: session.user.id, updateId: id },
  });
  return NextResponse.json({ ok: true });
}
