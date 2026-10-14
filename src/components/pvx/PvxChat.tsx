"use client";

import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { ADVISORS } from "@/components/pvx/PvxContact";
import { IconArrow, IconClose, IconLock, IconWhatsApp } from "@/components/pvx/PvxIcons";

// Chat con Michelle, la asistente virtual de provedix.com (2026-10-15).
// Se presenta siempre como asistente virtual con IA. El botón para seguir con
// la asesora (persona) por WhatsApp sale solo cuando la IA ya no puede resolver.

type Msg = { role: "user" | "assistant"; content: string };
const CHAT_KEY = "pvx-chat-id";
// Marca que pone la IA al final cuando ya no puede resolver el caso (ver provedixMichelle.ts).
const HANDOFF_MARK = "[[ASESORA]]";
// Quita la marca (también a medio llegar mientras se escribe la respuesta).
const cleanReply = (t: string) => t.replace(HANDOFF_MARK, "").replace(/\[\[?[A-Z]*\]?$/, "").trim();
const SUGGESTIONS = ["¿Qué productos van en subida?", "¿Cómo empiezo a vender con Provedix?", "¿A qué hora es el próximo corte?", "Recomiéndame algo para el hogar"];

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
          {line.split(/(\*\*[^*]+\*\*)/g).map((part, k) => (part.startsWith("**") && part.endsWith("**") ? <b key={k}>{part.slice(2, -2)}</b> : <Fragment key={k}>{part}</Fragment>))}
        </Fragment>
      ))}
    </>
  );
}

function Avatar({ size = 36 }: { size?: number }) {
  return (
    <span className="grid shrink-0 place-items-center rounded-full bg-[var(--pvx-orange)] font-black italic text-white" style={{ width: size, height: size, fontSize: size * 0.45 }} aria-hidden>
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

export function PvxChat({ registered, onRegister }: { registered: boolean; onRegister: () => void }) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [chatId, setChatId] = useState<string | null>(null);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Al abrir por primera vez: retoma la conversación guardada.
  useEffect(() => {
    if (!open || loaded) return;
    const id = readChatId();
    fetch(`/api/pvx/chat${id ? `?chatId=${encodeURIComponent(id)}` : ""}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.chatId) setChatId(d.chatId);
        if (Array.isArray(d?.messages)) setMessages(d.messages);
        if (typeof d?.remaining === "number") setRemaining(d.remaining);
      })
      .catch(() => null)
      .finally(() => setLoaded(true));
  }, [open, loaded]);

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
      setMessages((m) => [...m, { role: "user", content: text }, { role: "assistant", content: "" }]);
      try {
        const res = await fetch("/api/pvx/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: text, chatId: chatId ?? undefined }) });
        if (!res.ok || !res.body) {
          const d = await res.json().catch(() => null);
          setMessages((m) => m.slice(0, -2));
          setError(d?.error ?? "No pude responder ahora. Intenta de nuevo en un momento.");
          if (typeof d?.remaining === "number") setRemaining(d.remaining);
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
          setMessages((m) => [...m.slice(0, -1), { role: "assistant", content: acc }]);
        }
      } catch {
        setError("Se perdió la conexión. Intenta de nuevo.");
      } finally {
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
        aria-label={open ? "Cerrar el chat con Michelle" : "Abrir el chat con Michelle, asistente virtual"}
        className="pvx-press fixed bottom-4 right-4 z-[46] inline-flex items-center gap-2.5 rounded-full bg-[var(--pvx-ink)] py-2 pl-2 pr-4 text-left text-white shadow-[0_14px_34px_-12px_rgb(0_0_0/0.65)] ring-1 ring-white/15 hover:bg-[#25282f] cursor-pointer sm:bottom-6 sm:right-6"
      >
        <Avatar size={34} />
        <span className="leading-tight">
          <span className="block text-[14px] font-bold">{open ? "Cerrar chat" : "Pregúntale a Michelle"}</span>
          <span className="block text-[11px] font-semibold text-white/60">Asistente virtual · IA</span>
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
              <div className="text-[12px] text-white/65">Asistente virtual de Provedix · responde con IA</div>
            </div>
            <button type="button" onClick={() => setOpen(false)} aria-label="Cerrar chat" className="pvx-press grid h-9 w-9 place-items-center rounded-full bg-white/10 hover:bg-white/20 cursor-pointer">
              <IconClose className="w-5 h-5" />
            </button>
          </div>

          <div ref={listRef} className="flex-1 overflow-y-auto overscroll-contain bg-[var(--pvx-paper-2)] px-3 py-4" aria-live="polite">
            <div className="flex gap-2">
              <Avatar size={28} />
              <div className="max-w-[85%] rounded-2xl rounded-tl-md bg-white px-3.5 py-2.5 text-[14.5px] leading-relaxed">
¡Hola! 👋 Soy <b>Michelle</b>, tu asistente virtual de Provedix 😊 Estoy aquí para ayudarte a encontrar productos ganadores, ver cuánto se venden y resolver tus dudas. Cuéntame, ¿en qué te ayudo hoy? 💛
              </div>
            </div>

            {messages.length === 0 && loaded && (
              <div className="mt-3 flex flex-wrap gap-1.5 pl-9">
                {SUGGESTIONS.map((s) => (
                  <button key={s} type="button" onClick={() => send(s)} className="pvx-press rounded-full border border-[var(--pvx-paper-3)] bg-white px-3 py-1.5 text-[13px] font-semibold hover:border-[var(--pvx-orange)] cursor-pointer">
                    {s}
                  </button>
                ))}
              </div>
            )}

            {messages.map((m, i) =>
              m.role === "user" ? (
                <div key={i} className="mt-3 flex justify-end">
                  <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-tr-md bg-[var(--pvx-ink)] px-3.5 py-2.5 text-[14.5px] leading-relaxed text-white">{m.content}</div>
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
                            href={handoffUrl(ADVISORS.dropi.phone, messages.slice(0, i).findLast((x) => x.role === "user")?.content ?? "")}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="pvx-press mt-2.5 flex items-center justify-center gap-2 rounded-full bg-[#138a45] px-4 py-2.5 text-[14px] font-bold text-white hover:bg-[#0f7239]"
                          >
                            <IconWhatsApp className="w-4 h-4" /> Continuar con Michelle por WhatsApp
                          </a>
                        )}
                      </>
                    ) : (
                      <span className="inline-flex gap-1 py-1" aria-label="Michelle está escribiendo">
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
              <p role="alert" className="mt-3 rounded-xl bg-[#fde8e6] px-3 py-2 text-[13px] text-[#a12a1f]">
                {error}
              </p>
            )}
          </div>

          {!registered && (
            <button type="button" onClick={onRegister} className="flex items-center gap-2 bg-[var(--pvx-orange-soft)] px-4 py-2 text-left text-[12.5px] font-semibold hover:bg-[#ffe5d4] cursor-pointer">
              <IconLock className="w-4 h-4 shrink-0 text-[var(--pvx-orange-text)]" />
              <span className="flex-1">Regístrate gratis y Michelle te dará precio, ganancia, ciudades y combos.</span>
              <IconArrow className="w-4 h-4 shrink-0" />
            </button>
          )}

          <div className="border-t border-[var(--pvx-paper-3)] px-3 pb-3 pt-2">
            {/* Casos críticos → WhatsApp de Michelle (la asesora). Pedido 2026-10-14: la asistente resuelve
                lo normal para no sobrecargarla; ella atiende solo lo que requiere un análisis más complejo. */}
            {remaining != null && <div className="mb-1.5 text-right text-[11.5px] text-[var(--pvx-ink-3)]">{remaining} mensajes hoy</div>}
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
                placeholder={outOfMessages ? "Llegaste al límite de hoy…" : "Escribe tu pregunta…"}
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
            <p className="mt-1.5 text-center text-[10.5px] text-[var(--pvx-ink-3)]">Michelle es una IA y puede equivocarse. Guardamos la conversación para atenderte mejor.</p>
          </div>
        </div>
      )}
    </>
  );
}
