import { prisma } from "@/lib/prisma";
import type { PendingItem } from "@/lib/pendingTasks";

// Chats sospechosos con Michelle (pedido del usuario 2026-10-14): para que el
// admin vea en su Inicio quién intenta sacarle información o usarla para
// otra cosa, y con un clic vaya a leer la conversación.
//
// Una conversación es sospechosa si:
// - Michelle la cerró y bloqueó (mensaje role "blocked"), o
// - Michelle la marcó al responder ([[SOSPECHA]] → mensaje role "flag"), o
// - algún mensaje del dropshipper coincide con las frases de abajo (sirve
//   también para conversaciones de antes de este cambio).
// El admin la marca "Revisada" (mensaje role "reviewed"): deja de salir en
// Inicio hasta que pase algo sospechoso nuevo.

export const PROVEDIX_MICHELLE_HREF = "/admin/provedix#michelle";

const strip = (s: string) =>
  s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

const PATTERNS: { reason: string; re: RegExp }[] = [
  {
    reason: "Intentó manipularla",
    re: /(ignora|olvida|salta(te)?|cambia) (tus|las|todas las) (reglas|instrucciones)|soy (el|la) (dueno|duena|jefe|jefa|gerente|admin|administrador|programador|desarrollador)|modo (desarrollador|dios|admin)|jailbreak|actua como|finge (que|ser)|system prompt|\bprompt\b/,
  },
  {
    reason: "Preguntó por datos internos",
    re: /(cuanto|a como) (les|te|le) (cuesta|sale)|costo de compra|precio de compra|a como (lo|la|los|las) compran|quien es (el|su|tu) proveedor|de donde (lo|la|los|las)? ?(traen|importan|sacan|compran)|fabrica|cuantas unidades (hay|tienen|quedan)|unidades exactas|cuanto stock|nombres? de (las )?tiendas|datos de (los )?clientes/,
  },
  {
    reason: "Preguntó por el sistema",
    re: /tus instrucciones|como funcionas|base de datos|daflow|codigo fuente|\bapi\b|contrasena|password|\btoken\b|servidor|hack/,
  },
  {
    reason: "Pidió cosas fuera de tema",
    re: /genera(r|me)? (una |un )?(imagen|foto|logo|video)|dibuja|escribe(me)? (un|una) (codigo|ensayo|poema|cancion|cuento)|hazme (la|mi) tarea|traduce(me)?/,
  },
];

export function suspicionReasons(text: string): string[] {
  const t = strip(text);
  return PATTERNS.filter((p) => p.re.test(t)).map((p) => p.reason);
}

export type ChatSuspicion = {
  suspicious: boolean;
  reasons: string[];
  reviewedAt: Date | null;
  pending: boolean;
};

type Msg = { role: string; content: string; createdAt: Date };

// pending = hay algo sospechoso DESPUÉS de la última revisión del admin.
export function chatSuspicion(messages: Msg[]): ChatSuspicion {
  const reviewedAt = messages
    .filter((m) => m.role === "reviewed")
    .reduce<Date | null>(
      (a, m) => (!a || m.createdAt > a ? m.createdAt : a),
      null,
    );
  const reasons = new Set<string>();
  let last: Date | null = null;
  const hit = (m: Msg, r: string) => {
    reasons.add(r);
    if (!last || m.createdAt > last) last = m.createdAt;
  };
  for (const m of messages) {
    if (m.role === "blocked" || m.role === "unblocked")
      hit(m, "Michelle cerró el chat");
    else if (m.role === "blocked_24h")
      hit(m, "Bloqueado 24 h por datos de guía");
    else if (m.role === "flag") hit(m, "Michelle lo marcó como raro");
    else if (m.role === "guide_fail") hit(m, "Datos de guía que no coinciden");
    else if (m.role === "user")
      for (const r of suspicionReasons(m.content)) hit(m, r);
  }
  const lastHit = last as Date | null;
  return {
    suspicious: reasons.size > 0,
    reasons: [...reasons],
    reviewedAt,
    pending: !!lastHit && (!reviewedAt || lastHit > reviewedAt),
  };
}

// Inicio del admin: conversaciones sospechosas sin revisar (últimos 30 días).
export async function getProvedixSuspiciousChatsPendingItem(
  href: string = PROVEDIX_MICHELLE_HREF,
): Promise<PendingItem | null> {
  const chats = await prisma.provedixChat.findMany({
    where: { updatedAt: { gte: new Date(Date.now() - 30 * 86_400_000) } },
    select: {
      messages: {
        where: {
          role: {
            in: [
              "user",
              "blocked",
              "blocked_24h",
              "unblocked",
              "flag",
              "guide_fail",
              "reviewed",
            ],
          },
        },
        select: { role: true, content: true, createdAt: true },
      },
    },
  });
  const pending = chats
    .map((c) => chatSuspicion(c.messages))
    .filter((s) => s.pending);
  if (pending.length === 0) return null;
  const blocked = pending.filter((s) =>
    s.reasons.includes("Michelle cerró el chat"),
  ).length;
  return {
    type: "michelle_sospechosos",
    icon: "🛡️",
    label: "Michelle — conversaciones sospechosas por revisar",
    meta: `${pending.length} conversaci${pending.length === 1 ? "ón" : "ones"}${blocked ? ` · ${blocked} bloqueada${blocked === 1 ? "" : "s"}` : ""}`,
    overdue: blocked > 0,
    href,
  };
}
