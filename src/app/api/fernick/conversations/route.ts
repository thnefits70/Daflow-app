import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/guards";
import { prisma } from "@/lib/prisma";
import { fernickOwnerId } from "@/lib/fernick";

export async function GET() {
  const session = await requireAdminSession();
  if (!session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const conversations = await prisma.fernickConversation.findMany({
    where: { ownerId: fernickOwnerId() },
    orderBy: { updatedAt: "desc" },
    select: { id: true, title: true, createdAt: true, updatedAt: true, _count: { select: { messages: true } } },
  });

  return NextResponse.json(
    conversations.map((c) => ({
      id: c.id,
      title: c.title,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
      messageCount: c._count.messages,
    }))
  );
}
