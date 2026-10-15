"use client";

import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { ADVISORS } from "@/components/pvx/PvxContact";
import { PVX_CALC_EVENT } from "@/components/pvx/PvxCalculator";
import {
  IconArrow,
  IconClose,
  IconExternal,
  IconLock,
  IconWhatsApp,
} from "@/components/pvx/PvxIcons";

// Chat con Michelle, la asistente virtual de provedix.com (2026-10-15).
// Se presenta siempre como asistente virtual con IA. El botón para seguir con
// la asesora (persona) por WhatsApp sale solo cuando la IA ya no puede resolver.

type Msg = { role: "user" | "assistant"; content: string };
const CHAT_KEY = "pvx-chat-id";
// Marca que pone la IA al final cuando ya no puede resolver el caso (ver provedixMichelle.ts).
const HANDOFF_MARK = "[[ASESORA]]";
// Quita la marca (también a medio llegar mientras se escribe la respuesta).
// [[BLOQUEAR]]: la IA cerró el chat por un intento de sacar información confidencial.
const BLOCK_MARK = "[[BLOQUEAR]]";
// Botones de producto (2026-10-14): [[DROPI:ID]] precio en Dropi, [[CREATIVOS:ID]], [[LANDING:ID]].
const ACTION_RE = /\[\[(DROPI|CREATIVOS|LANDING|CALC):(\d{3,8})\]\]/g;
const ACTION_LABEL: Record<string, string> = {
  DROPI: "Ver precio en Dropi",
  CREATIVOS: "Ver creativos",
  LANDING: "Ver landing",
};
function actionsOf(t: string): { kind: string; code: string }[] {
  const seen = new Set<string>();
  const out: { kind: string; code: string }[] = [];
  for (const m of t.matchAll(ACTION_RE)) {
    if (seen.has(m[1] + m[2])) continue;
    seen.add(m[1] + m[2]);
    out.push({ kind: m[1], code: m[2] });
  }
  return out.slice(0, 6);
}
// Foto de evidencia de una guía retenida (la escribe el equipo, 2026-10-15).
const PHOTO_RE = /\[\[FOTO:([a-z0-9]{10,40})\]\]/gi;
const photoIdsOf = (t: string) =>
  [...t.matchAll(PHOTO_RE)].map((m) => m[1]).slice(0, 2);
const cleanReply = (t: string) =>
  t
    .replace(/\[\[(ASESORA|BLOQUEAR|SOSPECHA)\]\]/g, "")
    .replace(ACTION_RE, "")
    .replace(PHOTO_RE, "")
    // marca a medio llegar mientras se escribe la respuesta
    .replace(/\[(\[[A-Z]*(:\d*)?\]?)?$/, "")
    .trim();
const SUGGESTIONS = [
  "¿Qué productos van en subida?",
  "¿Cómo empiezo a vender con Provedix?",
  "¿A qué hora es el próximo corte?",
  "Recomiéndame algo para el hogar",
];

function readChatId(): string | null {
  try {
    return localStorage.getItem(CHAT_KEY);
  } catch {
    return null;
  }
}
function saveChatId(id: string) {
  try {
    localStorage.setItem(CHAT_KEY, id);
  } catch {
    // sin almacenamiento: la conversación igual sigue mientras la página esté abierta
  }
}

// Negritas (**texto**) y saltos de línea; nada de HTML.
function Rich({ text }: { text: string }) {
  return (
    <>
      {text.split("\n").map((line, i) => (
        <Fragment key={i}>
          {i > 0 && <br />}
          {line
            .split(/(\*\*[^*]+\*\*)/g)
            .map((part, k) =>
              part.startsWith("**") && part.endsWith("**") ? (
                <b key={k}>{part.slice(2, -2)}</b>
              ) : (
                <Fragment key={k}>{part}</Fragment>
              ),
            )}
        </Fragment>
      ))}
    </>
  );
}

function Avatar({ size = 36 }: { size?: number }) {
  return (
    <span
      className="grid shrink-0 place-items-center rounded-full bg-[var(--pvx-orange)] font-black italic text-white"
      style={{ width: size, height: size, fontSize: size * 0.45 }}
      aria-hidden
    >
      M
    </span>
  );
}

function handoffUrl(phone: string, lastQuestion: string): string {
  const text = lastQuestion
    ? `Hola Michelle, vengo del chat de Provedix y tengo un caso que necesita tu ayuda. Mi consulta: "${lastQuestion.slice(0, 300)}"`
    : "Hola Michelle, vengo del chat de Provedix y tengo un caso que necesita tu ayuda.";
  return `https://wa.me/${phone}?text=${encodeURIComponent(text)}`;
}

export function PvxChat({
  registered,
  onRegister,
}: {
  registered: boolean;
  onRegister: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [chatId, setChatId] = useState<string | null>(null);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [blocked, setBlocked] = useState(false);
  // Texto del bloqueo: permanente o de 24 h por datos de guía (lo manda el servidor).
  const [blockedMsg, setBlockedMsg] = useState(
    "Por seguridad, esta conversación quedó cerrada 🔒",
  );
  const listRef = useRef<HTMLDivElement>(null);
  // Última vez que se trajo la conversación: al volver a abrir el chat se
  // actualiza (así ve la respuesta del equipo sobre su guía, 2026-10-15).
  const lastLoadRef = useRef(0);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Al abrir: retoma la conversación guardada (y la actualiza si pasó más de 1 minuto).
  useEffect(() => {
    if (!open || busy || (loaded && Date.now() - lastLoadRef.current < 60_000))
      return;
    lastLoadRef.current = Date.now();
    const id = readChatId();
    fetch(`/api/pvx/chat${id ? `?chatId=${encodeURIComponent(id)}` : ""}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.chatId) setChatId(d.chatId);
        if (Array.isArray(d?.messages)) setMessages(d.messages);
        if (d?.blocked) {
          setBlocked(true);
          if (d.blockedText) setBlockedMsg(d.blockedText);
        }
        if (typeof d?.remaining === "number") setRemaining(d.remaining);
      })
      .catch(() => null)
      .finally(() => setLoaded(true));
  }, [open, loaded, busy]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages, busy]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const send = useCallback(
    async (raw: string) => {
      const text = raw.trim();
      if (!text || busy) return;
      setError("");
      setInput("");
      setBusy(true);
      setMessages((m) => [
        ...m,
        { role: "user", content: text },
        { role: "assistant", content: "" },
      ]);
      try {
        const res = await fetch("/api/pvx/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: text, chatId: chatId ?? undefined }),
        });
        if (!res.ok || !res.body) {
          const d = await res.json().catch(() => null);
          setMessages((m) => m.slice(0, -2));
          setError(
            d?.error ??
              "No pude responder ahora. Intenta de nuevo en un momento.",
          );
          if (typeof d?.remaining === "number") setRemaining(d.remaining);
          if (d?.blocked) {
            setBlocked(true);
            if (d.blockedText) setBlockedMsg(d.blockedText);
          }
          setInput(text);
          return;
        }
        const id = res.headers.get("X-Chat-Id");
        if (id) {
          setChatId(id);
          saveChatId(id);
        }
        const rem = res.headers.get("X-Remaining");
        if (rem != null) setRemaining(Number(rem));
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let acc = "";
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          acc += decoder.decode(value, { stream: true });
          setMessages((m) => [
            ...m.slice(0, -1),
            { role: "assistant", content: acc },
          ]);
          if (acc.includes(BLOCK_MARK)) {
            setBlocked(true);
            if (/24 horas/.test(acc))
              setBlockedMsg(
                "Por seguridad, este chat quedó bloqueado durante 24 horas 🔒",
              );
          }
        }
      } catch {
        setError("Se perdió la conexión. Intenta de nuevo.");
      } finally {
        // Lo recién conversado ya está en pantalla: no volver a traerlo enseguida.
        lastLoadRef.current = Date.now();
        setBusy(false);
        inputRef.current?.focus();
      }
    },
    [busy, chatId],
  );

  const outOfMessages = remaining === 0;

  return (
    <>
      <button
        type="button"
        data-tour="chat"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-label={
          open
            ? "Cerrar el chat con Michelle"
            : "Abrir el chat con Michelle, asistente virtual"
        }
        className="pvx-press fixed bottom-4 right-4 z-[46] inline-flex items-center gap-2.5 rounded-full bg-[var(--pvx-ink)] py-2 pl-2 pr-4 text-left text-white shadow-[0_14px_34px_-12px_rgb(0_0_0/0.65)] ring-1 ring-white/15 hover:bg-[#25282f] cursor-pointer sm:bottom-6 sm:right-6"
      >
        <Avatar size={34} />
        <span className="leading-tight">
          <span className="block text-[14px] font-bold">
            {open ? "Cerrar chat" : "Pregúntale a Michelle"}
          </span>
          <span className="block text-[11px] font-semibold text-white/60">
            Asistente virtual · IA
          </span>
        </span>
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Chat con Michelle, asistente virtual de Provedix"
          className="pvx-sheet fixed inset-x-0 bottom-0 z-[47] flex h-[min(88dvh,640px)] flex-col overflow-hidden rounded-t-[26px] bg-white text-[var(--pvx-ink)] shadow-[0_30px_80px_-20px_rgb(0_0_0/0.55)] sm:inset-x-auto sm:bottom-24 sm:right-6 sm:w-[390px] sm:rounded-[26px]"
        >
          <div className="flex items-center gap-3 bg-[var(--pvx-night)] px-4 py-3 text-white">
            <Avatar />
            <div className="min-w-0 flex-1">
              <div className="text-[15px] font-bold">Michelle</div>
              <div className="text-[12px] text-white/65">
                Asistente virtual de Provedix · responde con IA
              </div>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Cerrar chat"
              className="pvx-press grid h-9 w-9 place-items-center rounded-full bg-white/10 hover:bg-white/20 cursor-pointer"
            >
              <IconClose className="w-5 h-5" />
            </button>
          </div>

          <div
            ref={listRef}
            className="flex-1 overflow-y-auto overscroll-contain bg-[var(--pvx-paper-2)] px-3 py-4"
            aria-live="polite"
          >
            <div className="flex gap-2">
              <Avatar size={28} />
              <div className="max-w-[85%] rounded-2xl rounded-tl-md bg-white px-3.5 py-2.5 text-[14.5px] leading-relaxed">
                {registered ? (
                  <>
                    ¡Hola! 👋 Soy <b>Michelle</b>, tu asistente virtual de
                    Provedix 😊 Estoy aquí para ayudarte a encontrar productos
                    ganadores, ver cuánto se venden y resolver tus dudas.
                    Cuéntame, ¿en qué te ayudo hoy? 💛
                  </>
                ) : (
                  // Sin registro no hay conversación ni datos (pedido 2026-10-14).
                  <>
                    ¡Hola! 👋 Soy <b>Michelle</b>, tu asistente virtual de
                    Provedix 😊 Para conversar conmigo y darte toda la
                    información de los productos, primero{" "}
                    <b>regístrate gratis</b>. ¡Solo toma un minuto! 💛
                  </>
                )}
              </div>
            </div>

            {registered && !blocked && messages.length === 0 && loaded && (
              <div className="mt-3 flex flex-wrap gap-1.5 pl-9">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => send(s)}
                    className="pvx-press rounded-full border border-[var(--pvx-paper-3)] bg-white px-3 py-1.5 text-[13px] font-semibold hover:border-[var(--pvx-orange)] cursor-pointer"
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}

            {messages.map((m, i) =>
              m.role === "user" ? (
                <div key={i} className="mt-3 flex justify-end">
                  <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-tr-md bg-[var(--pvx-ink)] px-3.5 py-2.5 text-[14.5px] leading-relaxed text-white">
                    {m.content}
                  </div>
                </div>
              ) : (
                <div key={i} className="mt-3 flex gap-2">
                  <Avatar size={28} />
                  <div className="max-w-[85%] rounded-2xl rounded-tl-md bg-white px-3.5 py-2.5 text-[14.5px] leading-relaxed">
                    {m.content ? (
                      <>
                        <Rich text={cleanReply(m.content)} />
                        {/* La asistente pone la marca solo cuando ya no puede resolver el caso (pedido 2026-10-14):
                            recién ahí aparece el botón a Michelle, la asesora, con la consulta ya escrita. */}
                        {m.content.includes(HANDOFF_MARK) && (
                          <a
                            href={handoffUrl(
                              ADVISORS.dropi.phone,
                              messages
                                .slice(0, i)
                                .findLast((x) => x.role === "user")?.content ??
                                "",
                            )}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="pvx-press mt-2.5 flex items-center justify-center gap-2 rounded-full bg-[#138a45] px-4 py-2.5 text-[14px] font-bold text-white hover:bg-[#0f7239]"
                          >
                            <IconWhatsApp className="w-4 h-4" /> Continuar con
                            Michelle por WhatsApp
                          </a>
                        )}
                        {photoIdsOf(m.content).map((pid) => (
                          <a
                            key={pid}
                            href={`/api/pvx/chat/photo/${pid}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="mt-2.5 block overflow-hidden rounded-xl border border-[var(--pvx-paper-3)]"
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={`/api/pvx/chat/photo/${pid}`}
                              alt="Foto de evidencia de tu guía retenida"
                              className="max-h-72 w-full object-cover"
                              loading="lazy"
                            />
                          </a>
                        ))}
                        {actionsOf(m.content).length > 0 && (
                          <div className="mt-2.5 flex flex-wrap gap-1.5">
                            {actionsOf(m.content).map((a) =>
                              a.kind === "CALC" ? (
                                // Abre la calculadora de la página con este producto (2026-10-15).
                                <button
                                  key={a.kind + a.code}
                                  type="button"
                                  onClick={() => {
                                    setOpen(false);
                                    window.dispatchEvent(
                                      new CustomEvent(PVX_CALC_EVENT, {
                                        detail: a.code,
                                      }),
                                    );
                                  }}
                                  className="pvx-press inline-flex items-center gap-1.5 rounded-full bg-[var(--pvx-ink)] px-3.5 py-2 text-[13px] font-bold text-white hover:bg-[#25282f] cursor-pointer"
                                >
                                  🧮 Calcular mi ganancia · {a.code}
                                </button>
                              ) : (
                                <a
                                  key={a.kind + a.code}
                                  href={`/api/pvx/go/${a.kind.toLowerCase()}/${a.code}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className={`pvx-press inline-flex items-center gap-1.5 rounded-full px-3.5 py-2 text-[13px] font-bold ${a.kind === "DROPI" ? "bg-[var(--pvx-orange)] text-white hover:bg-[var(--pvx-orange-press)]" : "border border-[var(--pvx-paper-3)] bg-white hover:border-[var(--pvx-orange)]"}`}
                                >
                                  {ACTION_LABEL[a.kind]} · {a.code}
                                  <IconExternal className="w-3.5 h-3.5" />
                                </a>
                              ),
                            )}
                          </div>
                        )}
                      </>
                    ) : (
                      <span
                        className="inline-flex gap-1 py-1"
                        aria-label="Michelle está escribiendo"
                      >
                        <span className="h-2 w-2 animate-bounce rounded-full bg-[var(--pvx-ink-3)] [animation-delay:-0.3s]" />
                        <span className="h-2 w-2 animate-bounce rounded-full bg-[var(--pvx-ink-3)] [animation-delay:-0.15s]" />
                        <span className="h-2 w-2 animate-bounce rounded-full bg-[var(--pvx-ink-3)]" />
                      </span>
                    )}
                  </div>
                </div>
              ),
            )}
            {error && (
              <p
                role="alert"
                className="mt-3 rounded-xl bg-[#fde8e6] px-3 py-2 text-[13px] text-[#a12a1f]"
              >
                {error}
              </p>
            )}
          </div>

          <div className="border-t border-[var(--pvx-paper-3)] px-3 pb-3 pt-2">
            {!registered ? (
              <button
                type="button"
                onClick={onRegister}
                className="pvx-press mt-1 flex w-full items-center justify-center gap-2 rounded-full bg-[var(--pvx-orange)] px-4 py-3 text-[15px] font-bold text-white hover:bg-[var(--pvx-orange-press)] cursor-pointer"
              >
                <IconLock className="w-4 h-4" /> Regístrate gratis para
                conversar
              </button>
            ) : blocked ? (
              // Intento de sacar información confidencial: chat cerrado (pedido 2026-10-14).
              <p className="mt-1 rounded-xl bg-[var(--pvx-paper-2)] px-3 py-3 text-center text-[13.5px] font-semibold text-[var(--pvx-ink-2)]">
                {blockedMsg}
              </p>
            ) : (
              <>
                {remaining != null && (
                  <div className="mb-1.5 text-right text-[11.5px] text-[var(--pvx-ink-3)]">
                    {remaining} mensajes hoy
                  </div>
                )}
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    send(input);
                  }}
                  className="flex items-end gap-2"
                >
                  <label htmlFor="pvx-chat-input" className="sr-only">
                    Escribe tu pregunta para Michelle
                  </label>
                  <textarea
                    id="pvx-chat-input"
                    ref={inputRef}
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        send(input);
                      }
                    }}
                    rows={1}
                    maxLength={800}
                    disabled={outOfMessages}
                    placeholder={
                      outOfMessages
                        ? "Llegaste al límite de hoy…"
                        : "Escribe tu pregunta…"
                    }
                    className="max-h-28 min-h-[44px] flex-1 resize-none rounded-2xl bg-[var(--pvx-paper-2)] px-3.5 py-2.5 text-[16px] outline-none focus:bg-white focus:shadow-[0_0_0_2px_var(--pvx-orange)] disabled:opacity-60"
                  />
                  <button
                    type="submit"
                    disabled={busy || !input.trim() || outOfMessages}
                    aria-label="Enviar"
                    className="pvx-press grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[var(--pvx-orange)] text-white hover:bg-[var(--pvx-orange-press)] disabled:opacity-40 cursor-pointer"
                  >
                    <IconArrow className="w-5 h-5" />
                  </button>
                </form>
              </>
            )}
            <p className="mt-1.5 text-center text-[10.5px] text-[var(--pvx-ink-3)]">
              Michelle es una IA y puede equivocarse. Guardamos la conversación
              para atenderte mejor.
            </p>
          </div>
        </div>
      )}
    </>
  );
}
