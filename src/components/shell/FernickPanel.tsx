"use client";

import { useEffect, useRef, useState } from "react";
import { Send, Plus, Trash2, TrendingUp } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

// Same markdown rendering as NancyPanel — FERNICK also writes in markdown
// (bold, lists, tables) since it summarizes numbers and recommendations.
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

const STARTER_PROMPTS = [
  "¿Cuál es el cuello de botella más grande hoy para escalar la facturación?",
  "Con los datos actuales, ¿qué 3 acciones tendrían más impacto este mes?",
  "¿En qué etapa de escalamiento estamos camino a $1M/mes?",
];

// Página completa (no widget flotante como Nancy) — FERNICK es una vista
// propia del sidebar, no algo contextual a una sola pantalla. Mismo patrón
// de streaming + conversaciones guardadas que NancyPanel.tsx, adaptado a un
// layout de dos columnas (lista + chat) ya que aquí sí hay espacio de sobra.
export function FernickPanel() {
  const [conversations, setConversations] = useState<ConversationSummary[] | null>(null);
  const [loadingConversations, setLoadingConversations] = useState(true);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const bottomRef = useRef<HTMLDivElement>(null);

  const loadConversations = async () => {
    setLoadingConversations(true);
    const res = await fetch("/api/fernick/conversations");
    setLoadingConversations(false);
    if (res.ok) setConversations(await res.json());
  };

  useEffect(() => {
    loadConversations();
  }, []);

  const startNewConversation = () => {
    setConversationId(null);
    setMessages([]);
    setError(null);
  };

  const resumeConversation = async (id: string) => {
    setError(null);
    const res = await fetch(`/api/fernick/conversations/${id}`);
    if (!res.ok) {
      setError("No se pudo abrir esa conversación.");
      return;
    }
    const data = await res.json();
    setConversationId(data.id);
    setMessages(data.messages);
  };

  const deleteConversation = async (id: string) => {
    if (!confirm("¿Eliminar esta conversación con FERNICK? No se puede deshacer.")) return;
    if (id === conversationId) startNewConversation();
    await fetch(`/api/fernick/conversations/${id}`, { method: "DELETE" });
    loadConversations();
  };

  async function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || loading) return;
    setError(null);
    const nextMessages: ChatMessage[] = [...messages, { role: "user", content: trimmed }];
    setMessages([...nextMessages, { role: "assistant", content: "" }]);
    setInput("");
    setLoading(true);

    try {
      const res = await fetch("/api/fernick", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: nextMessages, conversationId: conversationId ?? undefined }),
      });
      if (!res.ok || !res.body) {
        const msg = await res.text().catch(() => "");
        throw new Error(msg || "Error al contactar a FERNICK.");
      }
      const returnedId = res.headers.get("X-Conversation-Id");
      const isNewConversation = !conversationId;
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
      if (isNewConversation) loadConversations();
      else setConversations((prev) => (prev ? [...prev] : prev));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al contactar a FERNICK.");
      setMessages((prev) => prev.slice(0, -1));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex gap-5 h-[calc(100vh-180px)] min-h-[480px]">
      <div className="w-[240px] shrink-0 flex flex-col border border-rule rounded-md bg-surface overflow-hidden">
        <div className="p-3 border-b border-rule shrink-0">
          <button
            type="button"
            onClick={startNewConversation}
            className="w-full flex items-center justify-center gap-1.5 rounded-md border-[1.5px] border-dashed border-rule text-teal hover:border-teal text-[12px] font-semibold py-2 cursor-pointer"
          >
            <Plus size={13} /> Nueva conversación
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-2">
          {loadingConversations && <div className="text-steel text-[12px] px-2 py-1">Cargando…</div>}
          {!loadingConversations && conversations?.length === 0 && (
            <div className="text-steel text-[11.5px] text-center py-4 px-2">Aún no tienes conversaciones con FERNICK.</div>
          )}
          {conversations?.map((c) => (
            <div
              key={c.id}
              className={`group flex items-center gap-1.5 rounded-md px-2.5 py-2 mb-1 cursor-pointer border ${
                c.id === conversationId ? "bg-teal/10 border-teal" : "border-transparent hover:bg-cloud"
              }`}
              onClick={() => resumeConversation(c.id)}
            >
              <div className="flex-1 min-w-0">
                <div className="text-[12px] font-semibold truncate">{c.title}</div>
                <div className="text-[10px] text-steel">
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
                <Trash2 size={12} />
              </button>
            </div>
          ))}
        </div>
      </div>

      <div className="flex-1 flex flex-col border border-rule rounded-md bg-surface overflow-hidden min-w-0">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-rule shrink-0">
          <TrendingUp size={15} className="text-teal shrink-0" />
          <div className="font-mono text-[10px] uppercase tracking-wide text-steel font-bold">FERNICK · asistente empresarial</div>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-4 min-h-0">
          {messages.length === 0 && (
            <div>
              <div className="text-[13px] text-steel mb-3">
                Pregúntale a FERNICK sobre el camino de Provedix hacia $1,000,000/mes de facturación — analiza los datos reales ya
                cargados en DAFLOW (finanzas, inventario, operación, compras) y te da lectura y recomendaciones concretas.
              </div>
              <div className="flex flex-col gap-1.5">
                {STARTER_PROMPTS.map((p) => (
                  <button
                    key={p}
                    type="button"
                    className="text-left text-[12.5px] rounded-md border border-rule px-3 py-2 hover:border-teal hover:bg-cloud cursor-pointer"
                    onClick={() => send(p)}
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="space-y-2.5">
            {messages.map((m, i) => (
              <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                <div
                  className={`max-w-[80%] rounded-md px-3.5 py-2.5 text-[13px] leading-relaxed ${
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

        {error && <div className="px-4 text-[11.5px] text-red">{error}</div>}

        <div className="px-4 pt-2.5 pb-3.5 border-t border-rule shrink-0">
          <div className="flex gap-2">
            <input
              type="text"
              className="flex-1 rounded border border-rule bg-cloud px-3 py-2.5 text-[13px] min-w-0"
              placeholder="Escribe tu pregunta para FERNICK..."
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send(input);
                }
              }}
              disabled={loading}
            />
            <button
              type="button"
              className="px-4 py-2.5 rounded-md bg-teal text-navy font-semibold text-[12.5px] cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5 shrink-0"
              onClick={() => send(input)}
              disabled={loading || !input.trim()}
            >
              <Send size={14} />
            </button>
          </div>
          <div className="mt-2 text-[10.5px] text-steel">
            💡 FERNICK analiza los datos ya cargados en DAFLOW — para dudas contables/fiscales puntuales, usa Nancy en KPIs financieros.
          </div>
        </div>
      </div>
    </div>
  );
}
