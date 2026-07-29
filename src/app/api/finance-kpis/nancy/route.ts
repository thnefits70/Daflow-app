import { NextRequest } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canEditDeptKpis } from "@/lib/guards";
import { getFinanceKpiData } from "@/lib/financeKpis";
import { getAnthropicClient, NANCY_SYSTEM_PROMPT, buildNancyContext, nancyOwnerId } from "@/lib/nancy";
import { logAiUsage } from "@/lib/aiUsage";

const messageSchema = z.object({ role: z.enum(["user", "assistant"]), content: z.string().min(1) });
const bodySchema = z.object({
  deptId: z.string().min(1),
  brand: z.string().min(1),
  messages: z.array(messageSchema).min(1).max(40),
  conversationId: z.string().min(1).optional(),
});

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return new Response("No autorizado.", { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return new Response(parsed.error.issues[0]?.message ?? "Datos inválidos.", { status: 400 });
  }
  const { deptId, brand, messages, conversationId: incomingConversationId } = parsed.data;

  if (!(await canEditDeptKpis(deptId))) {
    return new Response("No autorizado.", { status: 403 });
  }

  const lastMessage = messages[messages.length - 1];
  if (lastMessage.role !== "user") {
    return new Response("El último mensaje debe ser del usuario.", { status: 400 });
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return new Response(
      "Nancy todavía no está conectada — falta configurar la clave de Anthropic en el servidor.",
      { status: 503 }
    );
  }

  const ownerId = nancyOwnerId(session);

  // Retoma la conversación existente si el dueño coincide; si no vino
  // conversationId (o no era suya), se crea una nueva — el título sale del
  // primer mensaje para que la lista sea reconocible de un vistazo.
  let conversation = incomingConversationId
    ? await prisma.nancyConversation.findFirst({ where: { id: incomingConversationId, deptId, ownerId } })
    : null;
  if (!conversation) {
    conversation = await prisma.nancyConversation.create({
      data: { deptId, ownerId, title: lastMessage.content.slice(0, 60) },
    });
  }
  const conversationId = conversation.id;

  await prisma.nancyMessage.create({
    data: { conversationId, role: "user", content: lastMessage.content },
  });

  const data = await getFinanceKpiData(deptId);
  const context = buildNancyContext(data, { brand });
  const priorMessages = messages.slice(0, -1);

  const client = getAnthropicClient();
  const stream = client.messages.stream({
    model: "claude-opus-4-8",
    max_tokens: 4096,
    system: NANCY_SYSTEM_PROMPT,
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
        acc += "\n\n[Se perdió la conexión con Nancy — intenta de nuevo.]";
        controller.enqueue(encoder.encode("\n\n[Se perdió la conexión con Nancy — intenta de nuevo.]"));
      } finally {
        controller.close();
        if (acc.trim()) {
          await prisma.nancyMessage.create({ data: { conversationId, role: "assistant", content: acc } });
        }
        await prisma.nancyConversation.update({ where: { id: conversationId }, data: { updatedAt: new Date() } });

        const finalMessage = await stream.finalMessage().catch(() => null);
        if (finalMessage?.usage) {
          await logAiUsage({
            feature: "nancy",
            model: "claude-opus-4-8",
            actorId: ownerId,
            deptId,
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
