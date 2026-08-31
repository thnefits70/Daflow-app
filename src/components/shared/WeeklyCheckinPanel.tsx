"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ClipboardList, Send, X } from "lucide-react";

type ChatMessage = { role: "user" | "assistant"; content: string };

// Widget flotante del asistente de check-in semanal — reemplaza la reunión
// 1:1 admin-líder (ver src/lib/weeklyCheckin.ts). A diferencia de Nancy (que
// vive solo en la pantalla de KPIs financieros y maneja muchas
// conversaciones guardadas), este widget se monta para el LÍDER de un área
// con bitácora semanal (nunca para el resto del equipo, ver area/layout.tsx)
// y solo tiene UNA conversación activa a la vez — la de la semana en curso —
// así que no necesita props ni una vista de "lista".
// Posición bottom-left (Nancy usa bottom-right) para no chocar si alguien
// llega a ver ambos widgets en la misma sesión.
export function WeeklyCheckinPanel() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loadedOnce, setLoadedOnce] = useState(false);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open || loadedOnce) return;
    (async () => {
      const res = await fetch("/api/weekly-checkin");
      if (res.ok) {
        const data = await res.json();
        setMessages(data.messages ?? []);
      }
      setLoadedOnce(true);
    })();
  }, [open, loadedOnce]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

  async function send() {
    const text = input.trim();
    if (!text || loading) return;
    setError(null);
    const nextMessages: ChatMessage[] = [...messages, { role: "user", content: text }];
    setMessages([...nextMessages, { role: "assistant", content: "" }]);
    setInput("");
    setLoading(true);

    try {
      const res = await fetch("/api/weekly-checkin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: nextMessages }),
      });
      if (!res.ok || !res.body) {
        const msg = await res.text().catch(() => "");
        throw new Error(msg || "Error al contactar al asistente.");
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
      }
      // El registro (si el asistente ya tenía lo necesario) quedó guardado
      // del lado del servidor — refresca la página para que la bitácora de
      // Feedback semanal del líder lo vea sin recargar manualmente.
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al contactar al asistente.");
      setMessages((prev) => prev.slice(0, -1));
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      {open && (
        <div
          className="fixed bottom-24 left-5 z-[150] w-[min(380px,92vw)] max-h-[70vh] flex flex-col bg-surface border border-rule rounded-md shadow-2xl"
          role="dialog"
          aria-label="Check-in semanal"
        >
          <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-rule shrink-0">
            <div className="flex items-center gap-2 min-w-0">
              <ClipboardList size={15} className="text-teal shrink-0" />
              <div className="font-mono text-[10px] uppercase tracking-wide text-steel font-bold truncate">Check-in semanal</div>
            </div>
            <button type="button" title="Cerrar" className="p-1.5 rounded text-steel hover:text-ink cursor-pointer" onClick={() => setOpen(false)}>
              <X size={15} />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-4 py-3 min-h-[160px]">
            {messages.length === 0 && (
              <div className="text-[12.5px] text-steel">
                Cuéntame qué problemas tuviste esta semana y armamos juntos el plan para resolverlos.
              </div>
            )}
            <div className="space-y-2.5">
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
          </div>

          {error && <div className="px-4 text-[11.5px] text-red">{error}</div>}

          <div className="px-4 pt-2.5 pb-3 border-t border-rule shrink-0">
            <div className="flex gap-2">
              <input
                type="text"
                className="flex-1 rounded border border-rule bg-cloud px-3 py-2 text-[12.5px] min-w-0"
                placeholder="Escribe tu respuesta..."
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
                <Send size={14} />
              </button>
            </div>
          </div>
        </div>
      )}

      <button
        type="button"
        className="fixed bottom-5 left-5 z-[150] w-13 h-13 rounded-full bg-teal text-navy shadow-2xl cursor-pointer flex items-center justify-center hover:brightness-110"
        style={{ width: 52, height: 52 }}
        title="Check-in semanal"
        onClick={() => setOpen((v) => !v)}
      >
        {open ? <X size={22} /> : <ClipboardList size={22} />}
      </button>
    </>
  );
}
