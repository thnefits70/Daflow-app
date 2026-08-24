import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/guards";
import { prisma } from "@/lib/prisma";
import { fernickOwnerId } from "@/lib/fernick";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireAdminSession();
  if (!session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { id } = await params;
  const conversation = await prisma.fernickConversation.findUnique({
    where: { id },
    include: { messages: { orderBy: { createdAt: "asc" } } },
  });
  if (!conversation || conversation.ownerId !== fernickOwnerId()) {
    return NextResponse.json({ error: "No encontrada." }, { status: 404 });
  }

  return NextResponse.json({
    id: conversation.id,
    title: conversation.title,
    messages: conversation.messages.map((m) => ({ role: m.role, content: m.content })),
  });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireAdminSession();
  if (!session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { id } = await params;
  const conversation = await prisma.fernickConversation.findUnique({ where: { id } });
  if (!conversation || conversation.ownerId !== fernickOwnerId()) {
    return NextResponse.json({ error: "No encontrada." }, { status: 404 });
  }

  await prisma.fernickConversation.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
