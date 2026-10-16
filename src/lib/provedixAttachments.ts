import { prisma } from "@/lib/prisma";
import { supabaseAdmin } from "@/lib/supabase";

// Fotos y videos en el chat de Michelle IA (pedido del usuario 2026-10-16:
// "todo debe ser gestionado por Michelle IA, ya no por WhatsApp"). El
// dropshipper adjunta la evidencia (p. ej. de una garantía) en el mismo chat
// y la asesora la ve en el caso.
//
// El archivo va DIRECTO del navegador a un bucket privado propio ("pvx-chat",
// nombre neutro: la respuesta de Supabase muestra el bucket) con un enlace
// firmado de un solo uso, pero pasando por provedix.com/pvx/up/… (next.config.ts
// lo reenvía a Supabase): así no se ve la dirección del almacenamiento y no
// choca con el límite de 4,5 MB de las funciones.
// Para verlo, /api/pvx/chat/file/<id> revisa que sea del dueño del chat y
// manda a provedix.com/pvx/dl/… con un enlace firmado de pocos minutos.

export const ATTACH_BUCKET = "pvx-chat";
export const ATTACH_FOLDER = "chat";
let bucketReady = false;
async function ensureAttachBucket() {
  if (bucketReady) return;
  const sb = supabaseAdmin();
  const { data } = await sb.storage.listBuckets();
  if (!data?.some((b) => b.name === ATTACH_BUCKET)) {
    await sb.storage.createBucket(ATTACH_BUCKET, { public: false, fileSizeLimit: 50 * 1024 * 1024 });
  }
  bucketReady = true;
}
export const ATTACH_MARK_RE = /\[\[ADJUNTO:([a-z0-9]{10,40}):(image|video)\]\]/gi;
const IMAGE_TYPES: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/heic": "heic", "image/heif": "heif" };
const VIDEO_TYPES: Record<string, string> = { "video/mp4": "mp4", "video/quicktime": "mov", "video/webm": "webm", "video/3gpp": "3gp" };
export const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
export const MAX_VIDEO_BYTES = 50 * 1024 * 1024;
// Por chat y día: suficiente para una garantía, no para usarlo de disco.
const MAX_PER_DAY = 12;

export type UploadSlot = { id: string; uploadUrl: string; kind: "image" | "video" } | { error: string };

export async function createUploadSlot(chatId: string, file: { type: string; size: number }): Promise<UploadSlot> {
  const type = file.type.toLowerCase();
  const kind = IMAGE_TYPES[type] ? "image" : VIDEO_TYPES[type] ? "video" : null;
  if (!kind) return { error: "Solo puedes adjuntar fotos (JPG, PNG) o videos (MP4, MOV)." };
  const max = kind === "image" ? MAX_IMAGE_BYTES : MAX_VIDEO_BYTES;
  if (!(file.size > 0) || file.size > max)
    return { error: kind === "image" ? "La foto pesa demasiado (máximo 15 MB)." : "El video pesa demasiado (máximo 50 MB). Grábalo más corto, porfa." };
  const today = await prisma.provedixChatAttachment.count({
    where: { chatId, createdAt: { gte: new Date(Date.now() - 86_400_000) } },
  });
  if (today >= MAX_PER_DAY) return { error: "Llegaste al límite de archivos de hoy. Si necesitas enviar más, escríbelo en el chat." };

  await ensureAttachBucket();
  const ext = IMAGE_TYPES[type] ?? VIDEO_TYPES[type];
  const row = await prisma.provedixChatAttachment.create({
    data: { chatId, path: "", kind, bytes: Math.round(file.size) },
    select: { id: true },
  });
  const path = `${ATTACH_FOLDER}/${chatId}/${row.id}.${ext}`;
  const { data, error } = await supabaseAdmin().storage.from(ATTACH_BUCKET).createSignedUploadUrl(path);
  if (error || !data?.token) {
    await prisma.provedixChatAttachment.delete({ where: { id: row.id } }).catch(() => null);
    return { error: "No se pudo preparar la subida. Intenta de nuevo." };
  }
  await prisma.provedixChatAttachment.update({ where: { id: row.id }, data: { path } });
  // Ruta propia (next.config.ts): /pvx/up/<carpeta>/… → subida firmada del bucket privado.
  return { id: row.id, kind, uploadUrl: `/pvx/up/${path.slice(ATTACH_FOLDER.length + 1)}?token=${encodeURIComponent(data.token)}` };
}

// Confirma que el archivo llegó y lo pone en la conversación como mensaje del dropshipper.
export async function finishUpload(chatId: string, id: string): Promise<{ content: string } | { error: string }> {
  const row = await prisma.provedixChatAttachment.findFirst({ where: { id, chatId }, select: { path: true, kind: true, done: true } });
  if (!row?.path) return { error: "No encontré ese archivo." };
  const content = `[[ADJUNTO:${id}:${row.kind}]]`;
  if (row.done) return { content };
  const slash = row.path.lastIndexOf("/");
  const { data } = await supabaseAdmin()
    .storage.from(ATTACH_BUCKET)
    .list(row.path.slice(0, slash), { search: row.path.slice(slash + 1), limit: 1 });
  if (!data?.length) return { error: "El archivo no terminó de subir. Intenta de nuevo." };
  await prisma.$transaction([
    prisma.provedixChatAttachment.update({ where: { id }, data: { done: true } }),
    // "adjunto" no cuenta como mensaje del límite diario ni va a la IA como texto suelto.
    prisma.provedixChatMessage.create({ data: { chatId, role: "user", content } }),
    prisma.provedixChat.update({ where: { id: chatId }, data: { updatedAt: new Date() } }),
  ]);
  return { content };
}

// Enlace firmado corto para ver el archivo (del dueño del chat o del equipo).
export async function signedViewPath(id: string, chatIds: string[] | "team"): Promise<{ path: string; token: string; kind: string } | null> {
  const row = await prisma.provedixChatAttachment.findFirst({
    where: { id, done: true, ...(chatIds === "team" ? {} : { chatId: { in: chatIds } }) },
    select: { path: true, kind: true },
  });
  if (!row) return null;
  const { data } = await supabaseAdmin().storage.from(ATTACH_BUCKET).createSignedUrl(row.path, 600);
  const token = data?.signedUrl ? new URL(data.signedUrl).searchParams.get("token") : null;
  return token ? { path: row.path, token, kind: row.kind } : null;
}

// Para la IA: el adjunto se describe en palabras (no se le mandan las imágenes).
export function describeAttachments(text: string): string {
  return text.replace(ATTACH_MARK_RE, (_, _id, kind) => (kind === "video" ? "[El dropshipper adjuntó un video]" : "[El dropshipper adjuntó una foto]"));
}

// Respuesta escrita por la persona del equipo desde DAFLOW (no por la IA).
export const TEAM_MARK_RE = /^\[\[EQUIPO:([^\]]{1,40})\]\]\s*/;
export function describeTeamReply(text: string): string {
  return text.replace(TEAM_MARK_RE, (_, name) => `(Respuesta de ${name}, del equipo de Provedix) `);
}
