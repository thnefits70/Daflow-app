import { NextRequest } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getAnthropicClient } from "@/lib/nancy";
import { logAiUsage } from "@/lib/aiUsage";
import { WEEKLY_CHECKIN_MODEL } from "@/lib/weeklyCheckin";
import { EXPLAIN_SYSTEM_PROMPT, EXPLAIN_TOPICS, EXPLAIN_TOPIC_KEYS } from "@/lib/explainTopics";

// "¿Qué significa?" (2026-10-14): Mary explica un bloque de la pantalla. Solo
// recibe el texto que la persona ya está viendo (nada de la base) y las
// reglas de esa pantalla (explainTopics.ts). Una llamada por pregunta, solo
// cuando la persona toca el botón. No se guarda nada.
const messageSchema = z.object({ role: z.enum(["user", "assistant"]), content: z.string() });
const bodySchema = z.object({
  topic: z.enum(EXPLAIN_TOPIC_KEYS),
  screenText: z.string().min(1).max(4000),
  messages: z.array(messageSchema).max(12),
});

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return new Response("No autorizado.", { status: 403 });

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return new Response(parsed.error.issues[0]?.message ?? "Datos inválidos.", { status: 400 });
  if (!process.env.ANTHROPIC_API_KEY) {
    return new Response("Mary todavía no está conectada — falta configurar la clave de Anthropic en el servidor.", { status: 503 });
  }

  const me = await prisma.user.findUnique({ where: { id: session.user.id }, select: { name: true, isActive: true, deptId: true } });
  if (!me?.isActive) return new Response("No autorizado.", { status: 403 });

  const topic = EXPLAIN_TOPICS[parsed.data.topic];
  const firstName = me.name.split(" ")[0];
  const intro = `Hablas con ${firstName}. Pantalla: ${topic.label}.\n\nREGLAS DE ESTA PANTALLA:\n${topic.rules}\n\nTEXTO QUE ${firstName.toUpperCase()} VE EN EL BLOQUE QUE QUIERE ENTENDER:\n"""\n${parsed.data.screenText}\n"""\n\nExplícale qué significa esto y qué tiene que hacer.`;
  const followUps = parsed.data.messages.filter((m) => m.content.trim()).map((m) => ({ role: m.role, content: m.content.slice(0, 1500) }));
  if (followUps.length > 0 && followUps[followUps.length - 1].role !== "user") {
    return new Response("El último mensaje debe ser de la persona.", { status: 400 });
  }

  const client = getAnthropicClient();
  const stream = client.messages.stream({
    model: WEEKLY_CHECKIN_MODEL,
    max_tokens: 700,
    // Respuesta corta y rápida: sin razonamiento extendido (gastaba todo el
    // límite pensando y la explicación salía cortada).
    thinking: { type: "disabled" },
    system: EXPLAIN_SYSTEM_PROMPT,
    messages: [{ role: "user" as const, content: intro }, ...followUps],
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
      if (!acc.trim()) controller.enqueue(encoder.encode("Perdón, no alcancé a responder. Toca el botón otra vez."));
      controller.close();

      const finalMessage = await stream.finalMessage().catch(() => null);
      if (finalMessage?.usage) {
        await logAiUsage({
          feature: "mary_explicar",
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
