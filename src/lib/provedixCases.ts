import { revalidateTag, unstable_cache } from "next/cache";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { notifyOwner } from "@/lib/notifications";
import type { PendingItem } from "@/lib/pendingTasks";

// Casos que Michelle IA pasa a Michelle (la asesora humana) y respuestas que
// ella le enseña a la IA (pedido del usuario 2026-10-15): la IA resuelve
// primero; solo lo que de verdad no puede llega a la asesora, con un resumen
// y la conversación completa. Cuando ella lo resuelve puede "enseñar" la
// respuesta y la IA la usa desde ese momento.

export const CASES_URL = "/area/casos-michelle";
export const MICHELLE_ANSWERS_TAG = "provedix-michelle-answers";
// Quién atiende cada plataforma (2026-10-16, ya no hay WhatsApp: responden
// en el chat de Michelle IA desde aquí). Dropi: Michelle Ramírez (asesora
// B2B). Rocket: Yair. El admin ve todo.
const ADVISORS_BY_PLATFORM: Record<string, string[]> = {
  dropi: ["mramirez"],
  rocket: ["yairurgilez"],
};
const ADVISOR_USERNAMES = [...new Set(Object.values(ADVISORS_BY_PLATFORM).flat())];
export const PLATFORM_LABEL: Record<string, string> = { dropi: "Dropi", rocket: "Rocket" };
// Nombre con el que firma la respuesta en el chat del dropshipper.
const PLATFORM_SIGNER: Record<string, string> = { dropi: "Michelle", rocket: "Yair" };
function platformsOf(username: string | null | undefined): string[] {
  return Object.entries(ADVISORS_BY_PLATFORM)
    .filter(([, users]) => users.includes(username ?? ""))
    .map(([p]) => p);
}

export const CASE_TOPICS: Record<string, string> = {
  garantia: "Garantía",
  pedido: "Pedido o guía",
  pago: "Pago o cobro",
  negociacion: "Negociación (precio, volumen, crédito)",
  otro: "Otro",
};

export const formatCaseCode = (n: number) => `MC-${String(n).padStart(4, "0")}`;

export async function getCasesRole(): Promise<{
  userId: string;
  isAdmin: boolean;
  platforms: string[];
} | null> {
  const session = await auth();
  if (!session) return null;
  if (session.user.role === "admin")
    return { userId: session.user.id, isAdmin: true, platforms: Object.keys(ADVISORS_BY_PLATFORM) };
  const me = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { username: true, isActive: true },
  });
  return me?.isActive && ADVISOR_USERNAMES.includes(me.username ?? "")
    ? { userId: session.user.id, isAdmin: false, platforms: platformsOf(me.username) }
    : null;
}

// ¿Puede esta persona ver o atender este caso? (su plataforma, o admin)
export async function canSeeCase(caseId: string, platforms: string[]): Promise<boolean> {
  const c = await prisma.provedixCase.findUnique({ where: { id: caseId }, select: { platform: true } });
  return !!c && platforms.includes(c.platform);
}

async function advisorIds(platform: string): Promise<string[]> {
  const rows = await prisma.user.findMany({
    where: { username: { in: ADVISORS_BY_PLATFORM[platform] ?? ADVISORS_BY_PLATFORM.dropi }, isActive: true },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

// Lo llama Michelle IA (herramienta pasar_a_asesora). Devuelve el código del caso.
export async function createCaseFromChat(
  chatId: string,
  input: { tema: string; resumen: string; guia?: string | null; plataforma?: string | null },
): Promise<string> {
  const topic = CASE_TOPICS[input.tema] ? input.tema : "otro";
  // Plataforma: la que dijo la IA; si no, la del registro (solo Rocket → rocket).
  let platform = input.plataforma === "rocket" || input.plataforma === "dropi" ? input.plataforma : null;
  if (!platform) {
    const chat = await prisma.provedixChat.findUnique({ where: { id: chatId }, select: { lead: { select: { platform: true } } } });
    platform = chat?.lead?.platform === "ROCKET" ? "rocket" : "dropi";
  }
  // Si ese chat ya tiene un caso abierto del mismo tema, se actualiza el resumen (no se duplica).
  const open = await prisma.provedixCase.findFirst({
    where: { chatId, topic, status: "ABIERTO" },
    select: { id: true, number: true },
  });
  if (open) {
    await prisma.provedixCase.update({
      where: { id: open.id },
      data: {
        summary: input.resumen.slice(0, 1500),
        guideNumber: input.guia ?? undefined,
      },
    });
    return formatCaseCode(open.number);
  }
  for (let attempt = 0; attempt < 3; attempt++) {
    const last = await prisma.provedixCase.findFirst({
      orderBy: { number: "desc" },
      select: { number: true },
    });
    const number = (last?.number ?? 0) + 1;
    try {
      await prisma.provedixCase.create({
        data: {
          number,
          chatId,
          topic,
          platform,
          summary: input.resumen.slice(0, 1500),
          guideNumber: input.guia?.slice(0, 40) || null,
        },
      });
      const code = formatCaseCode(number);
      const ids = await advisorIds(platform);
      await Promise.all(
        ids.map((id) =>
          notifyOwner(id, {
            title: `Caso nuevo de Michelle IA · ${PLATFORM_LABEL[platform]}`,
            body: `${code} · ${CASE_TOPICS[topic]}: ${input.resumen.slice(0, 120)} · Responde en el chat (menos de 3 horas)`,
            url: CASES_URL,
          }).catch(() => null),
        ),
      );
      return code;
    } catch {
      // número tomado por otro caso al mismo tiempo: se reintenta
    }
  }
  return "MC-????";
}

export async function listCases(platforms: string[]) {
  const since = new Date(Date.now() - 30 * 86_400_000);
  const rows = await prisma.provedixCase.findMany({
    where: { platform: { in: platforms }, OR: [{ status: "ABIERTO" }, { createdAt: { gte: since } }] },
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    take: 150,
    select: {
      id: true,
      number: true,
      topic: true,
      platform: true,
      summary: true,
      guideNumber: true,
      status: true,
      resolution: true,
      resolvedAt: true,
      createdAt: true,
      chat: {
        select: {
          id: true,
          lead: { select: { name: true, whatsapp: true, storeName: true } },
        },
      },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    code: formatCaseCode(r.number),
    topic: r.topic,
    topicLabel: CASE_TOPICS[r.topic] ?? r.topic,
    platform: PLATFORM_LABEL[r.platform] ?? r.platform,
    summary: r.summary,
    guideNumber: r.guideNumber,
    status: r.status,
    resolution: r.resolution,
    resolvedAt: r.resolvedAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
    chatId: r.chat.id,
    who: r.chat.lead?.name ?? "Sin registro",
    whatsapp: r.chat.lead?.whatsapp ?? null,
    store: r.chat.lead?.storeName ?? null,
  }));
}

// Conversación completa del caso (solo lo que se dijeron, sin marcas internas).
export async function caseConversation(caseId: string) {
  const c = await prisma.provedixCase.findUnique({
    where: { id: caseId },
    select: { chatId: true },
  });
  if (!c) return [];
  const rows = await prisma.provedixChatMessage.findMany({
    where: { chatId: c.chatId, role: { in: ["user", "assistant"] } },
    orderBy: { createdAt: "asc" },
    take: 200,
    select: { role: true, content: true, createdAt: true },
  });
  return rows.map((m) => ({
    role: m.role,
    content: m.content
      .replace(/\[\[ASESORA(:[^\]]*)?\]\]/g, "→ pasó a la asesora")
      .replace(/\[\[(BLOQUEAR|SOSPECHA)\]\]/g, "")
      .replace(
        /\[\[(DROPI|CREATIVOS|LANDING|CALC|FICHA):(\d+)\]\]/g,
        "[botón $1 · $2]",
      )
      .replace(/\[\[IR:([a-z-]+)\]\]/g, "[botón ir a $1]")
      .replace(/\[\[FOTO:\w+\]\]/g, "[📸 foto]")
      .replace(/^\[\[EQUIPO:([^\]]+)\]\]\s*/, "($1, del equipo) ")
      .replace(/\[\[ADJUNTO:[^\]]+\]\]/g, "")
      .trim(),
    // Respuesta escrita por la persona del equipo (no por la IA).
    team: m.content.startsWith("[[EQUIPO:"),
    // Fotos y videos que adjuntó el dropshipper (2026-10-16): se abren desde el caso.
    attachments: [...m.content.matchAll(/\[\[ADJUNTO:([a-z0-9]{10,40}):(image|video)\]\]/gi)].map((a) => ({ id: a[1], kind: a[2] })),
    at: m.createdAt.toISOString(),
  }));
}

// Respuesta para el dropshipper (2026-10-15): le aparece en su chat de
// Michelle IA la próxima vez que lo abra. Sirve también en casos resueltos.
export async function sendCaseReply(caseId: string, reply: string): Promise<string | null> {
  const text = reply.trim().slice(0, 1000);
  if (!text) return "Escribe el mensaje.";
  const k = await prisma.provedixCase.findUnique({
    where: { id: caseId },
    select: { chatId: true, platform: true },
  });
  if (!k) return "No encontré ese caso.";
  // Firmada por la persona del equipo: el chat la muestra distinta a la IA (2026-10-16).
  await prisma.provedixChatMessage.create({
    data: { chatId: k.chatId, role: "assistant", content: `[[EQUIPO:${PLATFORM_SIGNER[k.platform] ?? "Michelle"}]] ${text}` },
  });
  await prisma.provedixChat.update({
    where: { id: k.chatId },
    data: { updatedAt: new Date() },
  });
  return null;
}

export async function resolveCase(
  caseId: string,
  userId: string | null,
  input: {
    resolution: string;
    reply?: string;
    teach?: { question: string; answer: string } | null;
  },
): Promise<string | null> {
  const updated = await prisma.provedixCase.updateMany({
    where: { id: caseId, status: "ABIERTO" },
    data: {
      status: "RESUELTO",
      resolution: input.resolution.slice(0, 2000),
      resolvedAt: new Date(),
      resolvedById: userId,
    },
  });
  if (updated.count === 0) return "Este caso ya estaba resuelto.";
  if (input.reply?.trim()) await sendCaseReply(caseId, input.reply);
  if (input.teach?.question.trim() && input.teach.answer.trim()) {
    await prisma.provedixAnswer.create({
      data: {
        question: input.teach.question.trim().slice(0, 500),
        answer: input.teach.answer.trim().slice(0, 2000),
        caseId,
        createdById: userId,
      },
    });
    refreshAnswers();
  }
  return null;
}

// ---- Respuestas aprendidas ----------------------------------------------------

function refreshAnswers() {
  try {
    revalidateTag(MICHELLE_ANSWERS_TAG, "max");
  } catch (e) {
    console.error("[provedixCases] revalidate", e);
  }
}

export async function listAnswers() {
  const rows = await prisma.provedixAnswer.findMany({
    orderBy: [{ active: "desc" }, { updatedAt: "desc" }],
    take: 300,
  });
  return rows.map((a) => ({
    id: a.id,
    question: a.question,
    answer: a.answer,
    active: a.active,
    updatedAt: a.updatedAt.toISOString(),
  }));
}

export async function saveAnswer(
  input: { id?: string; question: string; answer: string; active?: boolean },
  userId: string | null,
) {
  const data = {
    question: input.question.trim().slice(0, 500),
    answer: input.answer.trim().slice(0, 2000),
    ...(input.active != null ? { active: input.active } : {}),
  };
  if (input.id)
    await prisma.provedixAnswer.update({ where: { id: input.id }, data });
  else
    await prisma.provedixAnswer.create({
      data: { ...data, createdById: userId },
    });
  refreshAnswers();
}

export async function deleteAnswer(id: string) {
  await prisma.provedixAnswer.delete({ where: { id } }).catch(() => null);
  refreshAnswers();
}

// Para el conocimiento de Michelle IA (se actualiza apenas la asesora guarda una).
export const getActiveAnswers = unstable_cache(
  async () =>
    prisma.provedixAnswer.findMany({
      where: { active: true },
      orderBy: { updatedAt: "desc" },
      take: 120,
      select: { question: true, answer: true },
    }),
  ["provedix-michelle-answers"],
  { revalidate: 3600, tags: [MICHELLE_ANSWERS_TAG] },
);

// ---- Inicio de la asesora -------------------------------------------------------

export async function getCasesPendingItem(
  userId: string,
): Promise<PendingItem | null> {
  const me = await prisma.user.findUnique({
    where: { id: userId },
    select: { username: true },
  });
  const platforms = platformsOf(me?.username);
  if (!platforms.length) return null;
  const open = await prisma.provedixCase.findMany({
    where: { status: "ABIERTO", platform: { in: platforms } },
    select: { createdAt: true },
  });
  if (open.length === 0) return null;
  return {
    type: "michelle_casos",
    icon: "💬",
    label: "Casos que te pasó Michelle IA",
    meta: `${open.length} caso${open.length === 1 ? "" : "s"} por atender`,
    // Promesa de la página: respuesta en menos de 3 horas.
    overdue: open.some(
      (c) => Date.now() - c.createdAt.getTime() > 3 * 3_600_000,
    ),
    href: CASES_URL,
  };
}

// ---- Cuánto resuelve Michelle IA (panel del admin) ------------------------------

export type MichelleWeekStat = {
  week: string;
  conversations: number;
  escalated: number;
  resolvedByAi: number;
  topics: Record<string, number>;
};

// Últimas 8 semanas (lunes a domingo, hora de Ecuador aproximada): una
// conversación cuenta en la semana de su primer mensaje del dropshipper.
export async function michelleWeeklyStats(): Promise<MichelleWeekStat[]> {
  const since = new Date(Date.now() - 8 * 7 * 86_400_000);
  const [firstMsgs, cases] = await Promise.all([
    prisma.provedixChatMessage.groupBy({
      by: ["chatId"],
      where: { role: "user", createdAt: { gte: since } },
      _min: { createdAt: true },
    }),
    prisma.provedixCase.findMany({
      where: { createdAt: { gte: since } },
      select: { chatId: true, topic: true },
    }),
  ]);
  const weekOf = (d: Date) => {
    const x = new Date(d.getTime() - 5 * 3_600_000);
    const day = (x.getUTCDay() + 6) % 7;
    x.setUTCDate(x.getUTCDate() - day);
    return x.toISOString().slice(0, 10);
  };
  const byChatWeek = new Map(
    firstMsgs.map((m) => [m.chatId, weekOf(m._min.createdAt!)]),
  );
  const escalatedChats = new Map<string, string[]>();
  for (const c of cases)
    escalatedChats.set(c.chatId, [
      ...(escalatedChats.get(c.chatId) ?? []),
      c.topic,
    ]);
  const weeks = new Map<string, MichelleWeekStat>();
  for (const [chatId, week] of byChatWeek) {
    const w = weeks.get(week) ?? {
      week,
      conversations: 0,
      escalated: 0,
      resolvedByAi: 0,
      topics: {},
    };
    w.conversations++;
    const topics = escalatedChats.get(chatId);
    if (topics) {
      w.escalated++;
      for (const t of topics) w.topics[t] = (w.topics[t] ?? 0) + 1;
    } else w.resolvedByAi++;
    weeks.set(week, w);
  }
  return [...weeks.values()].sort((a, b) => b.week.localeCompare(a.week));
}
