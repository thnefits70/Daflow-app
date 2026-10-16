import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { createUploadSlot } from "@/lib/provedixAttachments";
import { chatVisitor, ownChat } from "@/lib/provedixChatAccess";
import { hitAllowed, sameOriginRequest, setVisitorCookies, tooMany } from "@/lib/provedixVisitor";

// Adjuntar una foto o video en el chat de Michelle IA (2026-10-16). Devuelve
// el enlace firmado para subir el archivo directo (ver provedixAttachments.ts).
const body = z.object({
  chatId: z.string().max(40).optional(),
  type: z.string().max(60),
  size: z.number().int().positive(),
});

export async function POST(req: NextRequest) {
  if (!sameOriginRequest(req)) return NextResponse.json({ error: "Solicitud no permitida." }, { status: 403 });
  if (!hitAllowed(req, "attach", 20, 60 * 60_000)) return tooMany();
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Archivo no válido." }, { status: 400 });
  const { visitorId, leadId } = await chatVisitor(req);
  if (!leadId) return NextResponse.json({ error: "Regístrate gratis para enviar archivos.", needsRegister: true }, { status: 401 });
  let chat = await ownChat(parsed.data.chatId, visitorId, leadId);
  if (!chat) chat = await prisma.provedixChat.create({ data: { visitorId, leadId }, select: { id: true } });
  const slot = await createUploadSlot(chat.id, parsed.data);
  if ("error" in slot) return NextResponse.json({ error: slot.error }, { status: 400 });
  const res = NextResponse.json({ ...slot, chatId: chat.id });
  setVisitorCookies(res, visitorId);
  return res;
}
