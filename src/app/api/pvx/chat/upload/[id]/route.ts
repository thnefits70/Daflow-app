import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { finishUpload } from "@/lib/provedixAttachments";
import { chatVisitor, ownChat } from "@/lib/provedixChatAccess";
import { sameOriginRequest } from "@/lib/provedixVisitor";

// El archivo ya subió: se pone en la conversación (2026-10-16).
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!sameOriginRequest(req)) return NextResponse.json({ error: "Solicitud no permitida." }, { status: 403 });
  const { id } = await params;
  const parsed = z.object({ chatId: z.string().max(40) }).safeParse(await req.json().catch(() => null));
  if (!parsed.success || !/^[a-z0-9]{10,40}$/i.test(id)) return NextResponse.json({ error: "Archivo no válido." }, { status: 400 });
  const { visitorId, leadId } = await chatVisitor(req);
  const chat = await ownChat(parsed.data.chatId, visitorId, leadId);
  if (!chat) return NextResponse.json({ error: "No encontré tu conversación." }, { status: 404 });
  const out = await finishUpload(chat.id, id);
  return "error" in out ? NextResponse.json(out, { status: 400 }) : NextResponse.json(out);
}
