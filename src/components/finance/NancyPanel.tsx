"use client";

import { useRef, useState } from "react";
import { Sparkles, Send } from "lucide-react";

type ChatMessage = { role: "user" | "assistant"; content: string };

// Chat UI for Nancy, the finance-KPI analysis assistant — scoped strictly to
// the data already loaded in this dashboard (see src/lib/nancy.ts for the
// system prompt and context builder). Streams the response token-by-token
// from POST /api/finance-kpis/nancy.
export function NancyPanel({ deptId, brand }: { deptId: string; brand: string }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

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
        body: JSON.stringify({ deptId, brand, messages: nextMessages }),
      });
      if (!res.ok || !res.body) {
        const msg = await res.text().catch(() => "");
        throw new Error(msg || "Error al contactar a Nancy.");
      }
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

  return (
    <div className="bg-surface border border-rule rounded-md p-4.5">
      <div className="flex items-center gap-2 mb-3">
        <Sparkles size={15} className="text-teal" />
        <div className="font-mono text-[10px] uppercase tracking-wide text-steel font-bold">Nancy · asistente financiera</div>
      </div>

      {messages.length === 0 && (
        <div className="text-[12.5px] text-steel mb-3">
          Pregúntale a Nancy sobre los KPIs de esta pantalla — por ejemplo &quot;¿por qué bajó el margen neto este mes?&quot; o &quot;explícame cómo se calcula el ROI&quot;.
        </div>
      )}

      {messages.length > 0 && (
        <div className="space-y-2.5 max-h-96 overflow-y-auto mb-3">
          {messages.map((m, i) => (
            <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
              <div
                className={`max-w-[85%] rounded-md px-3 py-2 text-[12.5px] leading-relaxed whitespace-pre-wrap ${
                  m.role === "user" ? "bg-blue text-white" : "bg-cloud border border-rule text-ink"
                }`}
              >
                {m.content || (loading && i === messages.length - 1 ? "…" : "")}
              </div>
            </div>
          ))}
          <div ref={bottomRef} />
        </div>
      )}

      {error && <div className="text-[11.5px] text-red mb-2">{error}</div>}

      <div className="flex gap-2">
        <input
          type="text"
          className="flex-1 rounded border border-rule bg-cloud px-3 py-2 text-[12.5px]"
          placeholder="Escribe tu pregunta..."
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
        <button
          type="button"
          className="px-3.5 py-2 rounded-md bg-teal text-navy font-semibold text-[12.5px] cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5 shrink-0"
          onClick={send}
          disabled={loading || !input.trim()}
        >
          <Send size={14} /> Enviar
        </button>
      </div>

      <div className="mt-3 pt-3 border-t border-dashed border-rule text-[11px] text-steel">
        💡 Nancy analiza solo los datos financieros/contables ya cargados en este panel — no reemplaza la revisión de tu contadora ni de tu asesor legal/financiero.
      </div>
    </div>
  );
}
