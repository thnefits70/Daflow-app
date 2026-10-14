import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getAnthropicClient } from "@/lib/nancy";
import { logAiUsage } from "@/lib/aiUsage";
import { readVisitor, sameOriginRequest, setVisitorCookies } from "@/lib/provedixVisitor";
import { MICHELLE_DAILY_LIMIT, MICHELLE_MODEL, michelleSystem } from "@/lib/provedixMichelle";

// Chat con Michelle, la asistente virtual de provedix.com (2026-10-15).
// POST: un mensaje nuevo (respuesta en streaming de texto). GET: retomar la
// conversación guardada de este navegador / registrado.

const DAY = 24 * 60 * 60 * 1000;
// Tope de gasto: si en 24 h toda la página pasa de esto, Michelle pide
// escribirle a la asesora (protege el saldo ante un ataque o un pico raro).
const GLOBAL_DAILY_LIMIT = 1500;
const MAX_HISTORY = 20;

// Por conexión (en cada servidor), por si alguien borra las cookies para
// saltarse el límite por persona.
const ipHits = new Map<string, number[]>();
function ipAllowed(req: NextRequest): boolean {
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "?";
  const now = Date.now();
  const hits = (ipHits.get(ip) ?? []).filter((t) => now - t < DAY);
  hits.push(now);
  ipHits.set(ip, hits);
  if (ipHits.size > 5000) ipHits.clear();
  return hits.length <= MICHELLE_DAILY_LIMIT * 2;
}

async function usedToday(visitorId: string, leadId: string | null): Promise<number> {
  return prisma.provedixChatMessage.count({
    where: {
      role: "user",
      createdAt: { gte: new Date(Date.now() - DAY) },
      chat: leadId ? { OR: [{ visitorId }, { leadId }] } : { visitorId },
    },
  });
}

async function findChat(chatId: string | undefined, visitorId: string, leadId: string | null) {
  if (!chatId) return null;
  return prisma.provedixChat.findFirst({ where: { id: chatId, OR: leadId ? [{ visitorId }, { leadId }] : [{ visitorId }] } });
}

export async function GET(req: NextRequest) {
  const { visitorId, leadId } = await readVisitor(req);
  const chatId = req.nextUrl.searchParams.get("chatId") ?? undefined;
  const chat = await findChat(chatId, visitorId, leadId);
  const messages = chat
    ? await prisma.provedixChatMessage.findMany({ where: { chatId: chat.id }, orderBy: { createdAt: "asc" }, take: 60, select: { role: true, content: true } })
    : [];
  const used = await usedToday(visitorId, leadId);
  const res = NextResponse.json({ chatId: chat?.id ?? null, messages, remaining: Math.max(0, MICHELLE_DAILY_LIMIT - used), registered: !!leadId });
  setVisitorCookies(res, visitorId);
  return res;
}

const bodySchema = z.object({
  message: z.string().trim().min(1, "Escribe tu pregunta.").max(800, "El mensaje es muy largo (máximo 800 letras)."),
  chatId: z.string().max(40).optional(),
});

export async function POST(req: NextRequest) {
  if (!sameOriginRequest(req)) return NextResponse.json({ error: "Solicitud no permitida." }, { status: 403 });
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Mensaje no válido." }, { status: 400 });
  if (!process.env.ANTHROPIC_API_KEY) return NextResponse.json({ error: "Michelle no está disponible en este momento." }, { status: 503 });

  const { visitorId, leadId } = await readVisitor(req);
  const used = await usedToday(visitorId, leadId);
  if (used >= MICHELLE_DAILY_LIMIT || !ipAllowed(req)) {
    return NextResponse.json({ error: "Llegaste al límite de mensajes de hoy 🙈 Mañana sigo ayudándote encantada. 💛", remaining: 0 }, { status: 429 });
  }
  const globalUsed = await prisma.provedixChatMessage.count({ where: { role: "user", createdAt: { gte: new Date(Date.now() - DAY) } } });
  if (globalUsed >= GLOBAL_DAILY_LIMIT) {
    return NextResponse.json({ error: "Estoy atendiendo a muchas personas en este momento 🙏 Inténtalo de nuevo en un ratito, porfa." }, { status: 503 });
  }

  let chat = await findChat(parsed.data.chatId, visitorId, leadId);
  if (!chat) chat = await prisma.provedixChat.create({ data: { visitorId, leadId } });
  else if (leadId && !chat.leadId) await prisma.provedixChat.update({ where: { id: chat.id }, data: { leadId } });
  const chatId = chat.id;

  const history = await prisma.provedixChatMessage.findMany({
    where: { chatId },
    orderBy: { createdAt: "desc" },
    take: MAX_HISTORY,
    select: { role: true, content: true },
  });
  await prisma.provedixChatMessage.create({ data: { chatId, role: "user", content: parsed.data.message } });

  // Historial en orden, empezando siempre por un mensaje del usuario.
  const prior = history.reverse();
  while (prior.length && prior[0].role !== "user") prior.shift();
  const messages: Anthropic.Beta.BetaMessageParam[] = [
    ...prior.map((m) => ({ role: m.role === "assistant" ? ("assistant" as const) : ("user" as const), content: m.content })),
    { role: "user", content: parsed.data.message },
  ];

  const system = await michelleSystem(!!leadId);
  const client = getAnthropicClient();
  const stream = client.beta.messages.stream({
    model: MICHELLE_MODEL,
    max_tokens: 2000,
    system,
    output_config: { effort: "low" },
    // Si un filtro de seguridad de la IA rechaza por error una pregunta
    // normal, Anthropic la reintenta sola con otro modelo.
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    messages,
    // El SDK instalado (0.114) solo tipa la forma con lista; la API acepta "default".
  } as unknown as Anthropic.Beta.Messages.MessageCreateParamsNonStreaming);

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
        const final = await stream.finalMessage().catch(() => null);
        if (final?.stop_reason === "refusal" && !acc.trim()) {
          acc = "Ay, perdón 🙏 esa pregunta no la puedo responder por aquí. ¿Te ayudo con algún producto o con cómo trabajar con Provedix? 😊";
          controller.enqueue(encoder.encode(acc));
        }
        if (final?.usage) {
          // Costo aproximado incluyendo el ahorro de caché (lectura ≈ 10 %,
          // escritura ≈ 125 % del precio normal de entrada).
          const u = final.usage;
          const inputEquivalent = Math.round(u.input_tokens + (u.cache_creation_input_tokens ?? 0) * 1.25 + (u.cache_read_input_tokens ?? 0) * 0.1);
          await logAiUsage({ feature: "provedix_michelle", model: MICHELLE_MODEL, actorId: `provedix:${leadId ?? visitorId}`, inputTokens: inputEquivalent, outputTokens: u.output_tokens });
        }
      } catch (err) {
        console.error("[michelle]", err);
        const msg = "\n\nUy, se me cortó la conexión 🙏 Intenta de nuevo en un momento, porfa.";
        acc += msg;
        controller.enqueue(encoder.encode(msg));
      } finally {
        controller.close();
        if (acc.trim()) await prisma.provedixChatMessage.create({ data: { chatId, role: "assistant", content: acc.trim() } }).catch(() => null);
        await prisma.provedixChat.update({ where: { id: chatId }, data: { updatedAt: new Date() } }).catch(() => null);
      }
    },
  });

  const res = new NextResponse(readable, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Chat-Id": chatId,
      "X-Remaining": String(Math.max(0, MICHELLE_DAILY_LIMIT - used - 1)),
    },
  });
  setVisitorCookies(res, visitorId);
  return res;
}
