import { prisma } from "@/lib/prisma";

// Embudo de Michelle IA (pedido del usuario 2026-10-17): desde que alguien
// abre el chat hasta que su conversación termina bien, y dónde se frena.
// Por persona (visitante), en los últimos 7 o 30 días. Solo el admin lo ve.
//
// Pasos:
//   1. Abrieron el chat (evento chat_open: enlace, botón, producto o página)
//   2. Podían escribir: ya registrados al abrir, o se registraron desde el chat
//   3. Escribieron su primer mensaje
//   4. Recibieron respuesta de Michelle IA
//   5. Éxito (decidido por el usuario): Michelle IA respondió, no hubo
//      bloqueo y, si pasó al equipo, el equipo ya respondió.
// Los eventos de apertura empezaron a guardarse el 2026-10-17: antes de esa
// fecha solo hay conversaciones (pasos 3 a 5).

export type FunnelStep = { key: string; label: string; value: number; pct: number | null };
export type FunnelBrake = { key: string; label: string; value: number; hint: string };
export type FunnelSource = { source: string; label: string; opened: number; wrote: number };
export type MichelleFunnel = {
  days: number;
  steps: FunnelStep[];
  brakes: FunnelBrake[];
  sources: FunnelSource[];
  conversations: number;
  success: number;
  successPct: number | null;
  escalated: number;
  teamAnswered: number;
  rating: { avg: number | null; count: number };
  avgMessages: number | null;
  trackingSince: string | null;
};

const SOURCE_LABEL: Record<string, string> = {
  enlace: "Enlace provedix.com/michelle",
  boton: "Botón flotante del chat",
  producto: "\"Preguntar\" en un producto",
  pagina: "Botones de la página",
};

const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 1000) / 10 : null);

export async function getMichelleFunnel(days: number): Promise<MichelleFunnel> {
  const since = new Date(Date.now() - days * 86_400_000);
  const [events, firstEvent, chats, ratings] = await Promise.all([
    prisma.provedixEvent.findMany({
      where: { type: { startsWith: "chat_" }, createdAt: { gte: since } },
      select: { visitorId: true, leadId: true, type: true, query: true, createdAt: true },
      orderBy: { createdAt: "asc" },
      take: 50_000,
    }),
    prisma.provedixEvent.findFirst({ where: { type: "chat_open" }, orderBy: { createdAt: "asc" }, select: { createdAt: true } }),
    prisma.provedixChat.findMany({
      where: { messages: { some: { role: "user", createdAt: { gte: since } } } },
      select: {
        id: true,
        visitorId: true,
        messages: { select: { role: true, content: true, createdAt: true }, orderBy: { createdAt: "asc" } },
        cases: { select: { createdAt: true, status: true } },
      },
      take: 5000,
    }),
    prisma.provedixRating.aggregate({ where: { tool: "michelle", createdAt: { gte: since } }, _avg: { stars: true }, _count: true }),
  ]);

  // ---- Aperturas (por visitante) ----
  const openers = new Map<string, { source: string; registered: boolean }>();
  const registeredFromChat = new Set<string>();
  const limit = new Set<string>();
  const busy = new Set<string>();
  let errors = 0;
  for (const e of events) {
    if (e.type === "chat_open") {
      const prev = openers.get(e.visitorId);
      openers.set(e.visitorId, { source: prev?.source ?? e.query ?? "pagina", registered: (prev?.registered ?? false) || !!e.leadId });
    } else if (e.type === "chat_register") registeredFromChat.add(e.visitorId);
    else if (e.type === "chat_limit") limit.add(e.visitorId);
    else if (e.type === "chat_busy") busy.add(e.visitorId);
    else if (e.type === "chat_error") errors++;
  }
  const wall = [...openers.values()].filter((o) => !o.registered).length;
  const canWrite = new Set([...openers].filter(([v, o]) => o.registered || registeredFromChat.has(v)).map(([v]) => v));

  // ---- Conversaciones ----
  const isAttachment = (c: string) => c.startsWith("[[ADJUNTO:");
  let success = 0;
  let escalated = 0;
  let teamAnswered = 0;
  let blocked = 0;
  let waitingTeam = 0;
  let totalUserMsgs = 0;
  const writers = new Set<string>();
  const respondedV = new Set<string>();
  const successV = new Set<string>();
  for (const c of chats) {
    const userMsgs = c.messages.filter((m) => m.role === "user" && !isAttachment(m.content));
    if (!userMsgs.length) continue;
    totalUserMsgs += userMsgs.length;
    writers.add(c.visitorId);
    const aiReply = c.messages.some((m) => m.role === "assistant" && !m.content.startsWith("[[EQUIPO:"));
    const isBlocked = c.messages.some((m) => m.role === "blocked" || m.role === "blocked_24h");
    const hasCase = c.cases.length > 0;
    const firstCase = hasCase ? Math.min(...c.cases.map((k) => k.createdAt.getTime())) : 0;
    // Atendido: el equipo respondió en el chat o marcó el caso como resuelto.
    const teamReply =
      hasCase &&
      (c.cases.every((k) => k.status === "RESUELTO") ||
        c.messages.some((m) => m.role === "assistant" && m.content.startsWith("[[EQUIPO:") && m.createdAt.getTime() >= firstCase));
    if (aiReply) {
      respondedV.add(c.visitorId);
    }
    if (isBlocked) blocked++;
    if (hasCase) escalated++;
    if (teamReply) teamAnswered++;
    if (hasCase && !teamReply) waitingTeam++;
    if (aiReply && !isBlocked && (!hasCase || teamReply)) {
      success++;
      successV.add(c.visitorId);
    }
  }
  const conversations = [...chats].filter((c) => c.messages.some((m) => m.role === "user" && !isAttachment(m.content))).length;

  // Embudo por persona: solo cuenta a quienes abrieron el chat (si no hay
  // aperturas guardadas todavía, se muestran las conversaciones solas).
  const tracked = openers.size > 0;
  const inOpeners = (s: Set<string>) => (tracked ? [...s].filter((v) => openers.has(v)).length : s.size);
  const opened = openers.size;
  const wrote = inOpeners(writers);
  const gotReply = inOpeners(respondedV);
  const ok = inOpeners(successV);
  const steps: FunnelStep[] = [
    { key: "opened", label: "Abrieron el chat", value: opened, pct: null },
    { key: "canWrite", label: "Registrados (podían escribir)", value: canWrite.size, pct: pct(canWrite.size, opened) },
    { key: "wrote", label: "Escribieron su primer mensaje", value: wrote, pct: pct(wrote, tracked ? canWrite.size : wrote) },
    { key: "reply", label: "Recibieron respuesta de Michelle IA", value: gotReply, pct: pct(gotReply, wrote) },
    { key: "success", label: "Terminaron con éxito", value: ok, pct: pct(ok, gotReply) },
  ];

  const brakes: FunnelBrake[] = [
    { key: "wall", label: "No se registraron", value: Math.max(0, wall - registeredFromChat.size), hint: "Abrieron el chat sin registro y no completaron el registro." },
    { key: "silent", label: "Abrieron y no escribieron", value: Math.max(0, canWrite.size - (tracked ? [...writers].filter((v) => canWrite.has(v)).length : 0)), hint: "Podían escribir pero cerraron sin preguntar nada." },
    { key: "limit", label: "Llegaron al límite de mensajes", value: limit.size, hint: "Ya no pudieron seguir ese día." },
    { key: "busy", label: "Michelle IA estaba saturada", value: busy.size, hint: "Límite general del día (muchas personas a la vez)." },
    { key: "error", label: "Errores de conexión", value: errors, hint: "Respuestas que se cortaron." },
    { key: "blocked", label: "Conversaciones bloqueadas", value: blocked, hint: "Por pedir información confidencial o datos de guía que no coinciden." },
    { key: "waiting", label: "Casos esperando al equipo", value: waitingTeam, hint: "Pasaron al equipo y todavía no tienen respuesta." },
  ];

  const sources: FunnelSource[] = Object.keys(SOURCE_LABEL).map((source) => {
    const vs = [...openers].filter(([, o]) => o.source === source).map(([v]) => v);
    return { source, label: SOURCE_LABEL[source], opened: vs.length, wrote: vs.filter((v) => writers.has(v)).length };
  });

  return {
    days,
    steps,
    brakes,
    sources,
    conversations,
    success,
    successPct: pct(success, conversations),
    escalated,
    teamAnswered,
    rating: { avg: ratings._avg.stars != null ? Math.round(ratings._avg.stars * 10) / 10 : null, count: ratings._count },
    avgMessages: conversations ? Math.round((totalUserMsgs / conversations) * 10) / 10 : null,
    trackingSince: firstEvent?.createdAt.toISOString() ?? null,
  };
}
