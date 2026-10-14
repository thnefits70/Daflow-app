"use client";

import { useRef, useState } from "react";

type Msg = { role: "user" | "assistant"; content: string };

// "¿Qué significa?" (pedido del usuario 2026-10-14): Mary explica en palabras
// sencillas el bloque donde está el botón. Toma el texto visible del
// contenedor más cercano con data-explain-scope (o el que se pase en
// `extra`) y permite seguir preguntando. Las reglas de cada pantalla están en
// src/lib/explainTopics.ts.
export function ExplainButton({ topic, extra, label = "¿Qué significa?" }: { topic: "que-comprar"; extra?: string; label?: string }) {
  const btnRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [screenText, setScreenText] = useState("");
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function ask(text: string, history: Msg[]) {
    setLoading(true);
    setError(null);
    const pending: Msg[] = [...history, { role: "assistant", content: "" }];
    setMessages(pending);
    try {
      const res = await fetch("/api/explain", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic, screenText: text, messages: history }),
      });
      if (!res.ok || !res.body) throw new Error((await res.text().catch(() => "")) || "Mary no pudo responder.");
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let acc = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        acc += decoder.decode(value, { stream: true });
        const now = acc;
        setMessages([...history, { role: "assistant", content: now }]);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Mary no pudo responder.");
      setMessages(history);
    } finally {
      setLoading(false);
    }
  }

  function start() {
    if (open) {
      setOpen(false);
      return;
    }
    setOpen(true);
    if (messages.length > 0) return;
    const scope = btnRef.current?.closest("[data-explain-scope]") as HTMLElement | null;
    const visible = (scope?.innerText ?? "").replace(/¿Qué significa\?/g, "").replace(/\n{2,}/g, "\n").trim();
    const text = [extra, visible].filter(Boolean).join("\n").slice(0, 4000);
    setScreenText(text);
    ask(text, []);
  }

  function send(e: React.FormEvent) {
    e.preventDefault();
    const q = input.trim();
    if (!q || loading) return;
    setInput("");
    ask(screenText, [...messages, { role: "user", content: q }]);
  }

  return (
    <div className="mt-1">
      <button
        ref={btnRef}
        type="button"
        onClick={start}
        className="inline-flex items-center gap-1 text-[11.5px] font-semibold text-teal hover:underline"
      >
        <span className="inline-flex items-center justify-center w-4 h-4 rounded-full border border-teal text-[10px] leading-none">?</span>
        {open ? "Cerrar explicación" : label}
      </button>
      {open && (
        <div className="mt-1.5 rounded-md border border-teal/40 bg-teal/5 px-3 py-2 text-[12.5px] text-ink max-w-[640px]">
          <div className="text-[11px] font-bold text-teal mb-1">Mary te explica</div>
          {messages.map((m, i) =>
            m.role === "user" ? (
              <div key={i} className="mt-2 text-[12px] text-steel">
                Tú: <span className="text-ink">{m.content}</span>
              </div>
            ) : (
              <div key={i} className="mt-1 whitespace-pre-wrap leading-relaxed">
                {m.content || (loading ? "Mary está escribiendo…" : "")}
              </div>
            ),
          )}
          {error && <div className="mt-1 text-red text-[12px]">{error}</div>}
          {!loading && messages.length > 0 && (
            <form onSubmit={send} className="mt-2 flex gap-1.5">
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                maxLength={500}
                placeholder="¿Algo más que no entiendas? Pregúntale aquí"
                className="flex-1 min-w-0 rounded border border-rule bg-surface px-2 py-1 text-[12px] text-ink"
              />
              <button type="submit" disabled={!input.trim()} className="shrink-0 rounded border border-teal px-2.5 py-1 text-[11.5px] font-semibold text-teal hover:bg-teal/10 disabled:opacity-50">
                Preguntar
              </button>
            </form>
          )}
        </div>
      )}
    </div>
  );
}
