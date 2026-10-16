import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getAnthropicClient } from "@/lib/nancy";
import { logAiUsage } from "@/lib/aiUsage";
import { describeAttachments, describeTeamReply } from "@/lib/provedixAttachments";
import {
  readVisitor,
  sameOriginRequest,
  hitAllowed,
  tooMany,
  setVisitorCookies,
} from "@/lib/provedixVisitor";
import {
  MICHELLE_DAILY_LIMIT,
  MICHELLE_MODEL,
  michelleSystem,
} from "@/lib/provedixMichelle";
import { checkGuideForDropshipper } from "@/lib/provedixGuideCheck";
import { requestCancellationFromChat } from "@/lib/michelleCancellations";
import { createCaseFromChat } from "@/lib/provedixCases";

// Pasar un caso al equipo con resumen (2026-10-15): solo lo que Michelle IA de
// verdad no puede resolver. Desde 2026-10-16 ya no hay WhatsApp: la persona
// del equipo (Michelle, la asesora, para Dropi; Yair para Rocket) responde en
// este mismo chat desde DAFLOW. Ver provedixCases.ts.
const HANDOFF_TOOL = {
  name: "pasar_a_asesora",
  description:
    "Crea un caso para el equipo humano (Michelle, la asesora, si vende en Dropi; Yair si vende en Rocket) cuando ya intentaste y NO puedes resolverlo tú (garantía evidente, pedido perdido o con problema serio, pago, negociación, o la persona pide hablar con una persona). Devuelve el código del caso (MC-0001). La persona del equipo le responde en este mismo chat. El resumen debe permitir atender sin volver a preguntar nada.",
  input_schema: {
    type: "object" as const,
    properties: {
      tema: {
        type: "string",
        enum: ["garantia", "pedido", "pago", "negociacion", "otro"],
        description: "Tema del caso",
      },
      resumen: {
        type: "string",
        description:
          "Resumen para la asesora: quién es y su tienda, qué pasó, número de guía y producto, si está dentro de 48 horas, qué ya le explicaste y qué necesita.",
      },
      guia: {
        type: "string",
        description: "Número de guía verificado, si lo hay",
      },
      plataforma: {
        type: "string",
        enum: ["dropi", "rocket"],
        description: "Dónde vende el dropshipper este pedido: dropi o rocket",
      },
    },
    required: ["tema", "resumen", "plataforma"],
  },
};
const handoffInput = z.object({
  tema: z.string().max(30),
  resumen: z.string().min(10).max(1500),
  guia: z.string().max(40).optional().nullable(),
  plataforma: z.enum(["dropi", "rocket"]).optional().nullable(),
});

// Herramienta de Michelle para consultar UNA guía (2026-10-14): solo con los
// 3 datos que tiene el dueño de la tienda (ver provedixGuideCheck.ts).
const GUIDE_TOOL = {
  name: "verificar_guia",
  description:
    "Verifica que quien pregunta es el dueño de la tienda de esa guía y, si los datos coinciden, devuelve su estado (despachada, en preparación o cancelada), la transportadora, la fecha de despacho y el enlace de rastreo. Úsala solo cuando la persona ya te dio los 3 datos. Nunca devuelve los datos reales de la guía.",
  input_schema: {
    type: "object" as const,
    properties: {
      guia: {
        type: "string",
        description: "Número de guía tal como lo escribió la persona",
      },
      tienda: {
        type: "string",
        description: "Nombre de la tienda (remitente) que dio la persona",
      },
      cliente: {
        type: "string",
        description: "Nombre completo del cliente que dio la persona",
      },
    },
    required: ["guia", "tienda", "cliente"],
  },
};
// Cancelar una guía (2026-10-15, reglas de Bryan y Daniel en michelleCancellations.ts):
// verifica al dueño igual que verificar_guia y, si todavía se puede, la manda
// al equipo de Inventarios para retenerla.
const CANCEL_TOOL = {
  name: "cancelar_guia",
  description:
    "Pide al equipo retener una guía que el dropshipper ya canceló en Dropi. Verifica que sea el dueño (mismos 3 datos que verificar_guia) y decide según el horario: en_gestion (se retiene), fuera_de_horario (el equipo revisa, sin promesas), ya_salio (ya se fue con la transportadora), ya_pedida (ya estaba pedida) o primero_dropi (todavía no la cancela en Dropi). Úsala solo cuando la persona ya te dio los 3 datos y te confirmó que la canceló en Dropi.",
  input_schema: {
    type: "object" as const,
    properties: {
      guia: {
        type: "string",
        description: "Número de guía tal como lo escribió la persona",
      },
      tienda: {
        type: "string",
        description: "Nombre de la tienda (remitente) que dio la persona",
      },
      cliente: {
        type: "string",
        description: "Nombre completo del cliente que dio la persona",
      },
      cancelo_en_dropi: {
        type: "boolean",
        description:
          "true solo si la persona confirmó que ya canceló el pedido en Dropi",
      },
    },
    required: ["guia", "tienda", "cliente", "cancelo_en_dropi"],
  },
};
const cancelInput = z.object({
  guia: z.string().min(1).max(40),
  tienda: z.string().min(1).max(120),
  cliente: z.string().min(1).max(120),
  cancelo_en_dropi: z.boolean(),
});
const guideInput = z.object({
  guia: z.string().min(1).max(40),
  tienda: z.string().min(1).max(120),
  cliente: z.string().min(1).max(120),
});

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
  const ip =
    (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "?";
  const now = Date.now();
  const hits = (ipHits.get(ip) ?? []).filter((t) => now - t < DAY);
  hits.push(now);
  ipHits.set(ip, hits);
  if (ipHits.size > 5000) ipHits.clear();
  return hits.length <= MICHELLE_DAILY_LIMIT * 2;
}

async function usedToday(
  visitorId: string,
  leadId: string | null,
): Promise<number> {
  return prisma.provedixChatMessage.count({
    where: {
      role: "user",
      createdAt: { gte: new Date(Date.now() - DAY) },
      // Los adjuntos (fotos/videos) no cuentan como mensajes (2026-10-16).
      NOT: { content: { startsWith: "[[ADJUNTO:" } },
      chat: leadId ? { OR: [{ visitorId }, { leadId }] } : { visitorId },
    },
  });
}

// Bloqueo (pedido del usuario 2026-10-14): si alguien intenta sacarle
// información confidencial, Michelle cierra el chat y esa persona (navegador
// y registro) ya no puede escribir. Se guarda como un mensaje con
// role "blocked" — el admin lo ve y puede desbloquear.
const BLOCK_MARK = "[[BLOQUEAR]]";

// Bloqueo de 24 h (pedido 2026-10-14): 3 veces datos de guía que no coinciden
// → role "blocked_24h"; se abre solo 24 h después. Devuelve el texto a mostrar
// o null si puede escribir.
async function blockedText(
  visitorId: string,
  leadId: string | null,
): Promise<string | null> {
  const chat = leadId ? { OR: [{ visitorId }, { leadId }] } : { visitorId };
  const since = new Date(Date.now() - DAY);
  const [perm, temp] = await Promise.all([
    prisma.provedixChatMessage.count({ where: { role: "blocked", chat } }),
    prisma.provedixChatMessage.findFirst({
      where: { role: "blocked_24h", createdAt: { gte: since }, chat },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    }),
  ]);
  if (perm > 0) return BLOCKED_TEXT;
  if (temp) {
    const until = new Date(temp.createdAt.getTime() + DAY).toLocaleString(
      "es-EC",
      {
        timeZone: "America/Guayaquil",
        weekday: "long",
        day: "numeric",
        month: "long",
        hour: "2-digit",
        minute: "2-digit",
      },
    );
    return `${BLOCKED_24H_TEXT} Podrás volver a escribirme el ${until} 💛`;
  }
  return null;
}

const BLOCKED_TEXT = "Por seguridad, esta conversación quedó cerrada 🔒";
const BLOCKED_24H_TEXT =
  "Por seguridad, este chat quedó bloqueado durante 24 horas porque la información de la guía no coincide 🔒";
const REGISTER_TEXT =
  "Para conversar conmigo primero regístrate gratis 😊 Así puedo darte toda la información de los productos.";
const INCOMPLETE_TEXT =
  "Antes de seguir, completa tus datos (nombre de tu tienda y dónde vendes) con el botón Regístrate, usando tu mismo WhatsApp 😊";

// Registro completo (2026-10-15): los registros viejos (antes del 14/10) no
// tienen tienda ni plataforma. Sin esos datos no se habla con la IA: el botón
// "Regístrate" abre el formulario y, con el mismo WhatsApp, solo completa lo
// que faltaba.
async function completeLead(leadId: string | null): Promise<string | null> {
  if (!leadId) return null;
  const lead = await prisma.provedixLead.findUnique({
    where: { id: leadId },
    select: { storeName: true, platform: true },
  });
  return lead?.storeName?.trim() && lead.platform ? leadId : null;
}

async function findChat(
  chatId: string | undefined,
  visitorId: string,
  leadId: string | null,
) {
  if (!chatId) return null;
  return prisma.provedixChat.findFirst({
    where: {
      id: chatId,
      OR: leadId ? [{ visitorId }, { leadId }] : [{ visitorId }],
    },
  });
}

export async function GET(req: NextRequest) {
  // Límite contra bots (2026-10-16): 60 lecturas del chat por minuto por conexión.
  if (!hitAllowed(req, "chatget", 60, 60_000)) return tooMany();
  const { visitorId, leadId: anyLead } = await readVisitor(req);
  const leadId = await completeLead(anyLead);
  const chatId = req.nextUrl.searchParams.get("chatId") ?? undefined;
  const chat = await findChat(chatId, visitorId, leadId);
  const messages = chat
    ? await prisma.provedixChatMessage.findMany({
        where: { chatId: chat.id, role: { in: ["user", "assistant"] } },
        orderBy: { createdAt: "asc" },
        take: 60,
        select: { role: true, content: true },
      })
    : [];
  const [used, blockMsg] = await Promise.all([
    usedToday(visitorId, leadId),
    blockedText(visitorId, leadId),
  ]);
  const res = NextResponse.json({
    chatId: chat?.id ?? null,
    messages,
    remaining: Math.max(0, MICHELLE_DAILY_LIMIT - used),
    registered: !!leadId,
    blocked: !!blockMsg,
    blockedText: blockMsg,
  });
  setVisitorCookies(res, visitorId);
  return res;
}

const bodySchema = z.object({
  message: z
    .string()
    .trim()
    .min(1, "Escribe tu pregunta.")
    .max(800, "El mensaje es muy largo (máximo 800 letras)."),
  chatId: z.string().max(40).optional(),
});

export async function POST(req: NextRequest) {
  if (!sameOriginRequest(req))
    return NextResponse.json(
      { error: "Solicitud no permitida." },
      { status: 403 },
    );
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Mensaje no válido." },
      { status: 400 },
    );
  if (!process.env.ANTHROPIC_API_KEY)
    return NextResponse.json(
      { error: "Michelle no está disponible en este momento." },
      { status: 503 },
    );

  const { visitorId, leadId: anyLead } = await readVisitor(req);
  const leadId = await completeLead(anyLead);
  // Sin registro completo no se habla con la IA (pedido 2026-10-14): ni un dato, ni costo.
  if (!leadId)
    return NextResponse.json(
      { error: anyLead ? INCOMPLETE_TEXT : REGISTER_TEXT, needsRegister: true },
      { status: 401 },
    );
  const blockMsg = await blockedText(visitorId, leadId);
  if (blockMsg)
    return NextResponse.json(
      { error: blockMsg, blocked: true, blockedText: blockMsg },
      { status: 403 },
    );
  const used = await usedToday(visitorId, leadId);
  if (used >= MICHELLE_DAILY_LIMIT || !ipAllowed(req)) {
    return NextResponse.json(
      {
        error:
          "Llegaste al límite de mensajes de hoy 🙈 Mañana sigo ayudándote encantada. 💛",
        remaining: 0,
      },
      { status: 429 },
    );
  }
  const globalUsed = await prisma.provedixChatMessage.count({
    where: { role: "user", createdAt: { gte: new Date(Date.now() - DAY) }, NOT: { content: { startsWith: "[[ADJUNTO:" } } },
  });
  if (globalUsed >= GLOBAL_DAILY_LIMIT) {
    return NextResponse.json(
      {
        error:
          "Estoy atendiendo a muchas personas en este momento 🙏 Inténtalo de nuevo en un ratito, porfa.",
      },
      { status: 503 },
    );
  }

  let chat = await findChat(parsed.data.chatId, visitorId, leadId);
  if (!chat)
    chat = await prisma.provedixChat.create({ data: { visitorId, leadId } });
  else if (leadId && !chat.leadId)
    await prisma.provedixChat.update({
      where: { id: chat.id },
      data: { leadId },
    });
  const chatId = chat.id;

  const history = await prisma.provedixChatMessage.findMany({
    where: { chatId, role: { in: ["user", "assistant"] } },
    orderBy: { createdAt: "desc" },
    take: MAX_HISTORY,
    select: { role: true, content: true },
  });
  await prisma.provedixChatMessage.create({
    data: { chatId, role: "user", content: parsed.data.message },
  });

  // Historial en orden, empezando siempre por un mensaje del usuario.
  const prior = history.reverse();
  while (prior.length && prior[0].role !== "user") prior.shift();
  // Adjuntos y respuestas del equipo van descritos en palabras; mensajes
  // seguidos del mismo lado se juntan en uno (2026-10-16).
  const messages: Anthropic.Beta.BetaMessageParam[] = [];
  for (const m of [...prior, { role: "user", content: parsed.data.message }]) {
    const role = m.role === "assistant" ? ("assistant" as const) : ("user" as const);
    const content = describeTeamReply(describeAttachments(m.content));
    const last = messages[messages.length - 1];
    if (last && last.role === role && typeof last.content === "string") last.content += `

${content}`;
    else messages.push({ role, content });
  }

  const system = await michelleSystem(true);
  const client = getAnthropicClient();
  const params = {
    model: MICHELLE_MODEL,
    max_tokens: 2000,
    system,
    output_config: { effort: "low" },
    tools: [GUIDE_TOOL, CANCEL_TOOL, HANDOFF_TOOL],
    // Si un filtro de seguridad de la IA rechaza por error una pregunta
    // normal, Anthropic la reintenta sola con otro modelo.
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
  };

  const encoder = new TextEncoder();
  let acc = "";
  let guideBlocked = false;
  const readable = new ReadableStream<Uint8Array>({
    async start(controller) {
      const usage = { input: 0, output: 0 };
      const emit = (t: string) => {
        acc += t;
        controller.enqueue(encoder.encode(t));
      };
      try {
        let convo = messages;
        // Como mucho 3 vueltas: respuesta → (verificar_guia) → respuesta final.
        for (let turn = 0; turn < 3; turn++) {
          // El SDK instalado (0.114) solo tipa "fallbacks" como lista; la API acepta "default".
          const stream = client.beta.messages.stream({
            ...params,
            messages: convo,
          } as unknown as Anthropic.Beta.Messages.MessageCreateParamsNonStreaming);
          if (turn > 0 && acc && !acc.endsWith("\n")) emit("\n\n");
          for await (const event of stream) {
            if (
              event.type === "content_block_delta" &&
              event.delta.type === "text_delta"
            )
              emit(event.delta.text);
          }
          const final = await stream.finalMessage().catch(() => null);
          if (final?.usage) {
            // Costo aproximado incluyendo el ahorro de caché (lectura ≈ 10 %,
            // escritura ≈ 125 % del precio normal de entrada).
            const u = final.usage;
            usage.input += Math.round(
              u.input_tokens +
                (u.cache_creation_input_tokens ?? 0) * 1.25 +
                (u.cache_read_input_tokens ?? 0) * 0.1,
            );
            usage.output += u.output_tokens;
          }
          if (final?.stop_reason === "refusal" && !acc.trim())
            emit(
              "Ay, perdón 🙏 esa pregunta no la puedo responder por aquí. ¿Te ayudo con algún producto o con cómo trabajar con Provedix? 😊",
            );
          if (final?.stop_reason !== "tool_use") break;
          const uses = final.content.filter(
            (b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use",
          );
          const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
          for (const use of uses) {
            const who = { visitorId, leadId };
            let out;
            if (use.name === "pasar_a_asesora") {
              // Caso para Michelle (la asesora humana), con resumen (2026-10-15).
              const input = handoffInput.safeParse(use.input);
              out = input.success
                ? {
                    resultado: "caso_creado",
                    codigo: await createCaseFromChat(chatId, input.data),
                  }
                : {
                    resultado: "faltan_datos",
                    detalle: "Escribe el tema y un resumen del caso.",
                  };
            } else if (use.name === "cancelar_guia") {
              const input = cancelInput.safeParse(use.input);
              out = input.success
                ? await requestCancellationFromChat(input.data, chatId, who)
                : { resultado: "no_coincide" as const, intentos_restantes: 0 };
            } else {
              const input = guideInput.safeParse(use.input);
              out = input.success
                ? await checkGuideForDropshipper(input.data, chatId, who)
                : { resultado: "no_coincide" as const, intentos_restantes: 0 };
            }
            if (out.resultado === "bloquear") guideBlocked = true;
            results.push({
              type: "tool_result",
              tool_use_id: use.id,
              content: JSON.stringify(out),
            });
          }
          convo = [
            ...convo,
            {
              role: "assistant",
              content: final.content as Anthropic.Beta.BetaContentBlockParam[],
            },
            { role: "user", content: results },
          ];
        }
        if (usage.input || usage.output) {
          await logAiUsage({
            feature: "provedix_michelle",
            model: MICHELLE_MODEL,
            actorId: `provedix:${leadId ?? visitorId}`,
            inputTokens: usage.input,
            outputTokens: usage.output,
          });
        }
        // Si la verificación de guías llegó al límite, el chat se cierra aunque la IA no ponga la marca.
        if (guideBlocked && !acc.includes(BLOCK_MARK))
          emit(`\n\n${BLOCKED_24H_TEXT}\n${BLOCK_MARK}`);
      } catch (err) {
        console.error("[michelle]", err);
        emit(
          "\n\nUy, se me cortó la conexión 🙏 Intenta de nuevo en un momento, porfa.",
        );
      } finally {
        controller.close();
        if (acc.trim())
          await prisma.provedixChatMessage
            .create({
              data: { chatId, role: "assistant", content: acc.trim() },
            })
            .catch(() => null);
        // Michelle respondió normal pero algo le pareció raro → aviso al admin (provedixSuspicion.ts).
        if (acc.includes("[[SOSPECHA]]") && !acc.includes(BLOCK_MARK)) {
          await prisma.provedixChatMessage
            .create({
              data: {
                chatId,
                role: "flag",
                content: "Michelle marcó esta pregunta como rara.",
              },
            })
            .catch(() => null);
        }
        // (Si fue por las guías, el bloqueo ya lo guardó provedixGuideCheck.ts.)
        if (acc.includes(BLOCK_MARK) && !guideBlocked) {
          await prisma.provedixChatMessage
            .create({
              data: {
                chatId,
                role: "blocked",
                content:
                  "Intentó sacar información confidencial: Michelle cerró el chat.",
              },
            })
            .catch(() => null);
        }
        await prisma.provedixChat
          .update({ where: { id: chatId }, data: { updatedAt: new Date() } })
          .catch(() => null);
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
