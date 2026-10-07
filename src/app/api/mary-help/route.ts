import { NextRequest } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getAnthropicClient } from "@/lib/nancy";
import { logAiUsage } from "@/lib/aiUsage";
import { WEEKLY_CHECKIN_MODEL } from "@/lib/weeklyCheckin";
import { MARY_HELP_SYSTEM_PROMPT, MARY_IMAGE_TYPES, MARY_MAX_IMAGES, MARY_MAX_IMAGE_BASE64, buildMaryHelpMap, maryUserContent } from "@/lib/maryHelp";

// Mary como guía de DAFLOW para quien no es líder (los líderes le preguntan
// lo mismo dentro de su chat de Feedback semanal, ver weekly-checkin). Solo
// guía: sin herramientas, sin leer registros, y el mapa de pantallas se
// arma en el servidor con los permisos reales de la sesión (ver
// maryHelp.ts). La conversación no se guarda en la base — vive en el
// navegador mientras la pestaña está abierta.
const messageSchema = z.object({ role: z.enum(["user", "assistant"]), content: z.string() });
const imageSchema = z.object({ mediaType: z.enum(MARY_IMAGE_TYPES), data: z.string().min(1).max(MARY_MAX_IMAGE_BASE64) });
const bodySchema = z.object({
  messages: z.array(messageSchema).min(1).max(30),
  // Solo las del último mensaje; nunca se guardan (ver maryUserContent).
  images: z.array(imageSchema).max(MARY_MAX_IMAGES).optional(),
});

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session || session.user.role !== "employee") {
    return new Response("No autorizado.", { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return new Response(parsed.error.issues[0]?.message ?? "Datos inválidos.", { status: 400 });
  }
  const messages = parsed.data.messages.filter((m) => m.content.trim()).map((m) => ({ ...m, content: m.content.slice(0, 4000) }));
  const lastMessage = messages[messages.length - 1];
  if (!lastMessage || lastMessage.role !== "user") {
    return new Response("El último mensaje debe ser del usuario.", { status: 400 });
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return new Response("El asistente todavía no está conectado — falta configurar la clave de Anthropic en el servidor.", { status: 503 });
  }

  const me = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { name: true, isActive: true, deptId: true, department: { select: { name: true } } },
  });
  if (!me?.isActive) return new Response("No autorizado.", { status: 403 });

  const map = await buildMaryHelpMap(session.user.id);
  const context = `CONTEXTO: hablas con ${me.name}, del área ${me.department?.name ?? "(sin área)"}.\n\n${map}`;

  const client = getAnthropicClient();
  const stream = client.messages.stream({
    model: WEEKLY_CHECKIN_MODEL,
    max_tokens: 800,
    system: MARY_HELP_SYSTEM_PROMPT,
    messages: [
      ...messages.slice(0, -1).map((m) => ({ role: m.role, content: m.content })),
      { role: "user" as const, content: maryUserContent(`${context}\n\nMENSAJE:\n${lastMessage.content}`, parsed.data.images) },
    ],
  });

  const encoder = new TextEncoder();
  const readable = new ReadableStream<Uint8Array>({
    async start(controller) {
      let acc = "";
      try {
        for await (const event of stream) {
          if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
            acc += event.delta.text;
            controller.enqueue(encoder.encode(event.delta.text));
          }
        }
      } catch {
        acc += "\n\n[Se perdió la conexión — intenta de nuevo.]";
        controller.enqueue(encoder.encode("\n\n[Se perdió la conexión — intenta de nuevo.]"));
      }
      if (!acc.trim()) controller.enqueue(encoder.encode("Perdón, no alcancé a responder. ¿Me lo puedes enviar de nuevo?"));
      controller.close();

      const finalMessage = await stream.finalMessage().catch(() => null);
      if (finalMessage?.usage) {
        await logAiUsage({
          feature: "mary_help",
          model: WEEKLY_CHECKIN_MODEL,
          actorId: session.user.id,
          deptId: me.deptId ?? undefined,
          inputTokens: finalMessage.usage.input_tokens,
          outputTokens: finalMessage.usage.output_tokens,
        });
      }
    },
  });

  return new Response(readable, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
}
