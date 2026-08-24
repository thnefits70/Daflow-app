import { NextRequest } from "next/server";
import { z } from "zod";
import { requireAdminSession } from "@/lib/guards";
import { prisma } from "@/lib/prisma";
import { getAnthropicClient } from "@/lib/nancy";
import { FERNICK_SYSTEM_PROMPT, buildFernickContext, fernickOwnerId } from "@/lib/fernick";
import { logAiUsage } from "@/lib/aiUsage";

const messageSchema = z.object({ role: z.enum(["user", "assistant"]), content: z.string().min(1) });
const bodySchema = z.object({
  messages: z.array(messageSchema).min(1).max(40),
  conversationId: z.string().min(1).optional(),
});

export async function POST(req: NextRequest) {
  const session = await requireAdminSession();
  if (!session) return new Response("No autorizado.", { status: 403 });

  const body = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return new Response(parsed.error.issues[0]?.message ?? "Datos inválidos.", { status: 400 });
  }
  const { messages, conversationId: incomingConversationId } = parsed.data;

  const lastMessage = messages[messages.length - 1];
  if (lastMessage.role !== "user") {
    return new Response("El último mensaje debe ser del usuario.", { status: 400 });
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return new Response(
      "FERNICK todavía no está conectado — falta configurar la clave de Anthropic en el servidor.",
      { status: 503 }
    );
  }

  const ownerId = fernickOwnerId();

  let conversation = incomingConversationId
    ? await prisma.fernickConversation.findFirst({ where: { id: incomingConversationId, ownerId } })
    : null;
  if (!conversation) {
    conversation = await prisma.fernickConversation.create({
      data: { ownerId, title: lastMessage.content.slice(0, 60) },
    });
  }
  const conversationId = conversation.id;

  await prisma.fernickMessage.create({
    data: { conversationId, role: "user", content: lastMessage.content },
  });

  const context = await buildFernickContext(ownerId, conversationId);
  const priorMessages = messages.slice(0, -1);

  const client = getAnthropicClient();
  const stream = client.messages.stream({
    model: "claude-opus-4-8",
    max_tokens: 4096,
    system: FERNICK_SYSTEM_PROMPT,
    thinking: { type: "adaptive" },
    output_config: { effort: "medium" },
    messages: [
      ...priorMessages.map((m) => ({ role: m.role, content: m.content })),
      { role: "user" as const, content: `${context}\n\nPREGUNTA:\n${lastMessage.content}` },
    ],
  });

  const encoder = new TextEncoder();
  let acc = "";
  const readable = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const event of stream) {
          if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
            acc += event.delta.text;
            controller.enqueue(encoder.encode(event.delta.text));
          }
        }
      } catch {
        acc += "\n\n[Se perdió la conexión con FERNICK — intenta de nuevo.]";
        controller.enqueue(encoder.encode("\n\n[Se perdió la conexión con FERNICK — intenta de nuevo.]"));
      } finally {
        controller.close();
        if (acc.trim()) {
          await prisma.fernickMessage.create({ data: { conversationId, role: "assistant", content: acc } });
        }
        await prisma.fernickConversation.update({ where: { id: conversationId }, data: { updatedAt: new Date() } });

        const finalMessage = await stream.finalMessage().catch(() => null);
        if (finalMessage?.usage) {
          await logAiUsage({
            feature: "fernick",
            model: "claude-opus-4-8",
            actorId: ownerId,
            inputTokens: finalMessage.usage.input_tokens,
            outputTokens: finalMessage.usage.output_tokens,
          });
        }
      }
    },
  });

  return new Response(readable, {
    headers: { "Content-Type": "text/plain; charset=utf-8", "X-Conversation-Id": conversationId },
  });
}
