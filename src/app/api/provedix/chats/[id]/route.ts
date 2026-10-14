import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getProvedixChatMessages, markProvedixChatReviewed, unblockProvedixChat } from "@/lib/provedixTraffic";

// Una conversación con Michelle (asistente virtual de provedix.com) — SOLO el admin.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session || session.user.role !== "admin") return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  const { id } = await params;
  return NextResponse.json(await getProvedixChatMessages(id));
}

// action "unblock": desbloquear a la persona (Michelle la bloqueó por intentar
// sacar información). action "reviewed": el admin ya leyó esta conversación
// sospechosa (deja de salir en su Inicio).
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session || session.user.role !== "admin") return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  const { id } = await params;
  const body = (await req.json().catch(() => null)) as { action?: string } | null;
  if (body?.action === "reviewed") await markProvedixChatReviewed(id);
  else if (body?.action === "unblock") await unblockProvedixChat(id);
  else return NextResponse.json({ error: "Acción no válida." }, { status: 400 });
  return NextResponse.json({ ok: true });
}
