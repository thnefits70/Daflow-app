"use client";

import { useEffect, useRef, useState } from "react";
import { Sparkles, Send, Mic, MicOff, Volume2, VolumeX, X, History, Plus, ArrowLeft, Trash2 } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

// Nancy writes in markdown (bold, tables) — render it instead of showing raw
// **/| syntax. Minimal component overrides since this project has no
// @tailwindcss/typography plugin; user bubbles stay plain text.
const MARKDOWN_COMPONENTS = {
  p: (props: React.ComponentPropsWithoutRef<"p">) => <p className="mb-2 last:mb-0" {...props} />,
  strong: (props: React.ComponentPropsWithoutRef<"strong">) => <strong className="font-bold text-ink" {...props} />,
  ul: (props: React.ComponentPropsWithoutRef<"ul">) => <ul className="list-disc pl-4 mb-2 space-y-0.5" {...props} />,
  ol: (props: React.ComponentPropsWithoutRef<"ol">) => <ol className="list-decimal pl-4 mb-2 space-y-0.5" {...props} />,
  li: (props: React.ComponentPropsWithoutRef<"li">) => <li {...props} />,
  a: (props: React.ComponentPropsWithoutRef<"a">) => <a className="text-teal underline" target="_blank" rel="noreferrer" {...props} />,
  table: (props: React.ComponentPropsWithoutRef<"table">) => (
    <div className="overflow-x-auto mb-2">
      <table className="border-collapse text-[11.5px]" {...props} />
    </div>
  ),
  th: (props: React.ComponentPropsWithoutRef<"th">) => (
    <th className="border border-rule px-2 py-1 text-left font-bold bg-navy/40" {...props} />
  ),
  td: (props: React.ComponentPropsWithoutRef<"td">) => <td className="border border-rule px-2 py-1" {...props} />,
};

type ChatMessage = { role: "user" | "assistant"; content: string };
type ConversationSummary = { id: string; title: string; updatedAt: string; messageCount: number };

// Minimal local typing for the (non-standard, not in lib.dom.d.ts everywhere)
// Web Speech API — avoids pulling in a dependency or touching global types.
// Chrome/Edge support this well; Safari/Firefox support is partial, so every
// call site feature-detects and degrades gracefully (mic button just hides).
type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  start: () => void;
  stop: () => void;
};
type SpeechWindow = Window & {
  SpeechRecognition?: new () => SpeechRecognitionLike;
  webkitSpeechRecognition?: new () => SpeechRecognitionLike;
};

// Floating chat widget for Nancy, the finance-KPI analysis assistant —
// scoped strictly to the data already loaded in this dashboard (see
// src/lib/nancy.ts for the system prompt and context builder). Fixed to the
// viewport so it stays reachable while scrolling through the KPI tiles above,
// per Andrés's ask 2026-07-23. Streams the response token-by-token from
// POST /api/finance-kpis/nancy; optional voice input (Web Speech API
// SpeechRecognition) and voice output (SpeechSynthesis) — both browser-native
// and free, no extra per-use cost beyond the existing Claude token spend.
export function NancyPanel({ deptId, brand }: { deptId: string; brand: string }) {
  const [open, setOpen] = useState(false);
  // "list" = elegir/retomar una conversación guardada o empezar una nueva;
  // "chat" = conversación activa (nueva o retomada). Confirmado 2026-07-27:
  // antes todo vivía solo en memoria y se perdía al salir de la pantalla.
  const [view, setView] = useState<"list" | "chat">("list");
  const [conversations, setConversations] = useState<ConversationSummary[] | null>(null);
  const [loadingConversations, setLoadingConversations] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [listening, setListening] = useState(false);
  const [voiceOutOn, setVoiceOutOn] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [micSupported, setMicSupported] = useState(false);
  const [speechSupported, setSpeechSupported] = useState(false);

  const bottomRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const lastSpokenRef = useRef<string | null>(null);

  const loadConversations = async () => {
    setLoadingConversations(true);
    const res = await fetch(`/api/finance-kpis/nancy/conversations?deptId=${deptId}`);
    setLoadingConversations(false);
    if (res.ok) setConversations(await res.json());
  };

  useEffect(() => {
    if (open && view === "list") loadConversations();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, view, deptId]);

  const startNewConversation = () => {
    setConversationId(null);
    setMessages([]);
    setError(null);
    setView("chat");
  };

  const resumeConversation = async (id: string) => {
    setError(null);
    const res = await fetch(`/api/finance-kpis/nancy/conversations/${id}`);
    if (!res.ok) {
      setError("No se pudo abrir esa conversación.");
      return;
    }
    const data = await res.json();
    setConversationId(data.id);
    setMessages(data.messages);
    setView("chat");
  };

  const deleteConversation = async (id: string) => {
    if (!confirm("¿Eliminar esta conversación con Nancy? No se puede deshacer.")) return;
    await fetch(`/api/finance-kpis/nancy/conversations/${id}`, { method: "DELETE" });
    loadConversations();
  };

  // Same "assume default, flip after mount" pattern used in WeeklyTrendChart
  // — keeps the server-rendered markup identical to the first client render.
  useEffect(() => {
    setReducedMotion(window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    const sw = window as SpeechWindow;
    setMicSupported(!!(sw.SpeechRecognition || sw.webkitSpeechRecognition));
    setSpeechSupported("speechSynthesis" in window);
  }, []);

  // Auto-read Nancy's reply once it finishes streaming (not mid-stream, to
  // avoid choppy audio) — only when the voice-output toggle is on.
  useEffect(() => {
    if (!voiceOutOn || loading || messages.length === 0) return;
    const last = messages[messages.length - 1];
    if (last.role !== "assistant" || !last.content || last.content === lastSpokenRef.current) return;
    lastSpokenRef.current = last.content;
    window.speechSynthesis.cancel();
    const spoken = last.content
      .replace(/\|/g, " ")
      .replace(/^-{3,}$/gm, "")
      .replace(/[*_#`]/g, "");
    const utterance = new SpeechSynthesisUtterance(spoken);
    utterance.lang = "es-EC";
    window.speechSynthesis.speak(utterance);
  }, [messages, loading, voiceOutOn]);

  function toggleListening() {
    const sw = window as SpeechWindow;
    const Ctor = sw.SpeechRecognition || sw.webkitSpeechRecognition;
    if (!Ctor) return;

    if (listening) {
      recognitionRef.current?.stop();
      return;
    }

    const recognition = new Ctor();
    recognition.lang = "es-EC";
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.onresult = (event) => {
      let transcript = "";
      for (let i = 0; i < event.results.length; i++) transcript += event.results[i][0].transcript;
      setInput(transcript);
    };
    recognition.onend = () => setListening(false);
    recognition.onerror = () => setListening(false);
    recognitionRef.current = recognition;
    setListening(true);
    recognition.start();
  }

  async function send() {
    const text = input.trim();
    if (!text || loading) return;
    setError(null);
    const nextMessages: ChatMessage[] = [...messages, { role: "user", content: text }];
    setMessages([...nextMessages, { role: "assistant", content: "" }]);
    setInput("");
    setLoading(true);

    try {
      const res = await fetch("/api/finance-kpis/nancy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deptId, brand, messages: nextMessages, conversationId: conversationId ?? undefined }),
      });
      if (!res.ok || !res.body) {
        const msg = await res.text().catch(() => "");
        throw new Error(msg || "Error al contactar a Nancy.");
      }
      // El primer mensaje de una conversación nueva no trae conversationId
      // todavía — el servidor la crea y la devuelve en este header.
      const returnedId = res.headers.get("X-Conversation-Id");
      if (returnedId && returnedId !== conversationId) setConversationId(returnedId);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let acc = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        acc += decoder.decode(value, { stream: true });
        const finalText = acc;
        setMessages((prev) => {
          const copy = prev.slice();
          copy[copy.length - 1] = { role: "assistant", content: finalText };
          return copy;
        });
        bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al contactar a Nancy.");
      setMessages((prev) => prev.slice(0, -1));
    } finally {
      setLoading(false);
    }
  }

  // Small "alive / listening" badge — a solid dot plus an expanding ring
  // behind it (Tailwind's animate-ping), same idea as a live-status
  // indicator. Skipped under prefers-reduced-motion (just the solid dot).
  function LiveDot({ size = 9 }: { size?: number }) {
    return (
      <span className="relative inline-flex" style={{ width: size, height: size }}>
        {!reducedMotion && (
          <span className="absolute inline-flex h-full w-full rounded-full bg-teal opacity-60 animate-ping" />
        )}
        <span className="relative inline-flex rounded-full bg-teal" style={{ width: size, height: size }} />
      </span>
    );
  }

  return (
    <>
      {open && (
        <div
          className="fixed bottom-24 right-5 z-[150] w-[min(400px,92vw)] max-h-[75vh] flex flex-col bg-surface border border-rule rounded-md shadow-2xl"
          role="dialog"
          aria-label="Chat con Nancy"
        >
          <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-rule shrink-0">
            <div className="flex items-center gap-2 min-w-0">
              {view === "chat" && (
                <button
                  type="button"
                  title="Ver conversaciones guardadas"
                  className="p-1 -ml-1 rounded text-steel hover:text-ink cursor-pointer shrink-0"
                  onClick={() => setView("list")}
                >
                  <ArrowLeft size={15} />
                </button>
              )}
              <Sparkles size={15} className="text-teal shrink-0" />
              <div className="font-mono text-[10px] uppercase tracking-wide text-steel font-bold truncate">Nancy · asistente financiera</div>
              <LiveDot />
            </div>
            <div className="flex items-center gap-1 shrink-0">
              {view === "chat" && (
                <button
                  type="button"
                  title="Nueva conversación"
                  className="p-1.5 rounded text-steel hover:text-ink cursor-pointer"
                  onClick={startNewConversation}
                >
                  <Plus size={15} />
                </button>
              )}
              {view === "chat" && (
                <button
                  type="button"
                  title="Conversaciones guardadas"
                  className="p-1.5 rounded text-steel hover:text-ink cursor-pointer"
                  onClick={() => setView("list")}
                >
                  <History size={15} />
                </button>
              )}
              {speechSupported && (
                <button
                  type="button"
                  title={voiceOutOn ? "Desactivar respuesta por voz" : "Activar respuesta por voz"}
                  className={`p-1.5 rounded cursor-pointer ${voiceOutOn ? "text-teal" : "text-steel hover:text-ink"}`}
                  onClick={() => {
                    if (voiceOutOn) window.speechSynthesis.cancel();
                    setVoiceOutOn((v) => !v);
                  }}
                >
                  {voiceOutOn ? <Volume2 size={15} /> : <VolumeX size={15} />}
                </button>
              )}
              <button
                type="button"
                title="Cerrar"
                className="p-1.5 rounded text-steel hover:text-ink cursor-pointer"
                onClick={() => setOpen(false)}
              >
                <X size={15} />
              </button>
            </div>
          </div>

          {view === "list" ? (
            <div className="flex-1 overflow-y-auto px-4 py-3 min-h-[160px]">
              <button
                type="button"
                onClick={startNewConversation}
                className="w-full flex items-center justify-center gap-1.5 rounded-md border-[1.5px] border-dashed border-rule text-teal hover:border-teal text-[12.5px] font-semibold py-2.5 cursor-pointer mb-3"
              >
                <Plus size={14} /> Nueva conversación
              </button>

              {loadingConversations && <div className="text-steel text-[12px]">Cargando…</div>}
              {!loadingConversations && conversations?.length === 0 && (
                <div className="text-steel text-[12px] text-center py-4">Aún no tienes conversaciones guardadas con Nancy.</div>
              )}
              {conversations?.map((c) => (
                <div
                  key={c.id}
                  className="group flex items-center gap-2 rounded-md border border-rule bg-cloud px-3 py-2.5 mb-2 cursor-pointer hover:border-teal"
                  onClick={() => resumeConversation(c.id)}
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-[12.5px] font-semibold truncate">{c.title}</div>
                    <div className="text-[10.5px] text-steel">
                      {new Date(c.updatedAt).toLocaleDateString("es-EC", { day: "2-digit", month: "short" })} · {c.messageCount} mensaje
                      {c.messageCount === 1 ? "" : "s"}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="opacity-0 group-hover:opacity-100 p-1 text-steel hover:text-red cursor-pointer shrink-0"
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteConversation(c.id);
                    }}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}
            </div>
          ) : (
          <div className="flex-1 overflow-y-auto px-4 py-3 min-h-[160px]">
            {messages.length === 0 && (
              <div className="text-[12.5px] text-steel">
                Pregúntale a Nancy sobre los KPIs de esta pantalla — por ejemplo &quot;¿por qué bajó el margen neto este mes?&quot; o &quot;explícame cómo se calcula el ROI&quot;.
              </div>
            )}
            <div className="space-y-2.5">
              {messages.map((m, i) => (
                <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                  <div
                    className={`max-w-[85%] rounded-md px-3 py-2 text-[12.5px] leading-relaxed ${
                      m.role === "user" ? "bg-blue text-white whitespace-pre-wrap" : "bg-cloud border border-rule text-ink"
                    }`}
                  >
                    {m.role === "assistant" ? (
                      m.content ? (
                        <ReactMarkdown remarkPlugins={[remarkGfm]} components={MARKDOWN_COMPONENTS}>
                          {m.content}
                        </ReactMarkdown>
                      ) : loading && i === messages.length - 1 ? (
                        "…"
                      ) : (
                        ""
                      )
                    ) : (
                      m.content
                    )}
                  </div>
                </div>
              ))}
              <div ref={bottomRef} />
            </div>
          </div>
          )}

          {view === "chat" && error && <div className="px-4 text-[11.5px] text-red">{error}</div>}

          {view === "chat" && (
          <div className="px-4 pt-2.5 pb-3 border-t border-rule shrink-0">
            <div className="flex gap-2">
              <input
                type="text"
                className="flex-1 rounded border border-rule bg-cloud px-3 py-2 text-[12.5px] min-w-0"
                placeholder={listening ? "Escuchando..." : "Escribe o dicta tu pregunta..."}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    send();
                  }
                }}
                disabled={loading}
              />
              {micSupported && (
                <button
                  type="button"
                  title={listening ? "Detener dictado" : "Dictar por voz"}
                  className={`px-2.5 py-2 rounded-md border shrink-0 cursor-pointer ${
                    listening ? "bg-red/20 border-red text-red" : "border-rule text-steel hover:text-ink"
                  } ${listening && !reducedMotion ? "animate-pulse" : ""}`}
                  onClick={toggleListening}
                  disabled={loading}
                >
                  {listening ? <MicOff size={15} /> : <Mic size={15} />}
                </button>
              )}
              <button
                type="button"
                className="px-3.5 py-2 rounded-md bg-teal text-navy font-semibold text-[12.5px] cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5 shrink-0"
                onClick={send}
                disabled={loading || !input.trim()}
              >
                <Send size={14} />
              </button>
            </div>
            <div className="mt-2.5 text-[10.5px] text-steel">
              💡 Nancy analiza solo los datos ya cargados en este panel — no reemplaza a tu contadora ni a tu asesor legal/financiero.
            </div>
          </div>
          )}
        </div>
      )}

      <button
        type="button"
        className="fixed bottom-5 right-5 z-[150] w-13 h-13 rounded-full bg-teal text-navy shadow-2xl cursor-pointer flex items-center justify-center hover:brightness-110"
        style={{ width: 52, height: 52 }}
        title="Nancy · asistente financiera"
        onClick={() => setOpen((v) => !v)}
      >
        {open ? (
          <X size={22} />
        ) : (
          <span className="relative inline-flex">
            <Sparkles size={22} />
            <span className="absolute -top-0.5 -right-0.5">
              <LiveDot size={8} />
            </span>
          </span>
        )}
      </button>
    </>
  );
}
