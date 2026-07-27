import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { nancyOwnerId } from "@/lib/nancy";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "No autorizado." }, { status: 401 });

  const { id } = await params;
  const conversation = await prisma.nancyConversation.findUnique({
    where: { id },
    include: { messages: { orderBy: { createdAt: "asc" } } },
  });
  if (!conversation || conversation.ownerId !== nancyOwnerId(session)) {
    return NextResponse.json({ error: "No encontrada." }, { status: 404 });
  }

  return NextResponse.json({
    id: conversation.id,
    title: conversation.title,
    messages: conversation.messages.map((m) => ({ role: m.role, content: m.content })),
  });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "No autorizado." }, { status: 401 });

  const { id } = await params;
  const conversation = await prisma.nancyConversation.findUnique({ where: { id } });
  if (!conversation || conversation.ownerId !== nancyOwnerId(session)) {
    return NextResponse.json({ error: "No encontrada." }, { status: 404 });
  }

  await prisma.nancyConversation.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
