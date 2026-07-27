"use client";

import { useEffect, useState } from "react";
import { Send } from "lucide-react";

type ChatMessage = { id: string; senderId: string; senderName: string; body: string; createdAt: string };

export function PayrollChat({ employeeId, canSend }: { employeeId: string; canSend: boolean }) {
  const [messages, setMessages] = useState<ChatMessage[] | null>(null);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState("");

  const load = async () => {
    const res = await fetch(`/api/payroll-messages/${employeeId}`);
    if (res.ok) setMessages(await res.json());
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [employeeId]);

  const send = async () => {
    if (!text.trim()) return;
    setSending(true);
    setErr("");
    const res = await fetch(`/api/payroll-messages/${employeeId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body: text.trim() }),
    });
    setSending(false);
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setErr(data?.error ?? "No se pudo enviar el mensaje.");
      return;
    }
    setText("");
    load();
  };

  return (
    <div className="mt-2.5 border border-rule rounded-md bg-cloud p-3">
      <div className="max-h-64 overflow-y-auto space-y-2 mb-2.5">
        {messages === null && <div className="text-steel text-[12px]">Cargando…</div>}
        {messages?.length === 0 && <div className="text-steel text-[12px]">Sin mensajes todavía.</div>}
        {messages?.map((m) => {
          const fromEmployee = m.senderId === employeeId;
          return (
            <div key={m.id} className={`flex ${fromEmployee ? "justify-start" : "justify-end"}`}>
              <div
                className={`max-w-[78%] rounded-lg px-3 py-2 text-[12.5px] ${
                  fromEmployee ? "bg-surface border border-rule" : "bg-blue text-white"
                }`}
              >
                <div className={`text-[10px] font-semibold mb-0.5 ${fromEmployee ? "text-steel" : "text-white/75"}`}>
                  {m.senderName}
                </div>
                <div className="whitespace-pre-wrap break-words">{m.body}</div>
                <div className={`text-[9.5px] mt-1 ${fromEmployee ? "text-steel/70" : "text-white/60"}`}>
                  {new Date(m.createdAt).toLocaleString("es-EC", {
                    day: "2-digit",
                    month: "short",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {err && <div className="text-red text-[11px] mb-1.5">{err}</div>}

      {canSend ? (
        <div className="flex gap-2">
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && send()}
            placeholder="Escribe un mensaje…"
            className="flex-1 bg-surface border border-rule rounded px-2.5 py-1.5 text-[12.5px]"
          />
          <button
            type="button"
            disabled={sending || !text.trim()}
            onClick={send}
            className="px-3 py-1.5 rounded bg-blue text-white text-[12px] font-semibold cursor-pointer disabled:opacity-50 flex items-center gap-1"
          >
            <Send size={13} /> Enviar
          </button>
        </div>
      ) : (
        <div className="text-[11px] text-steel italic">Solo lectura — puedes ver la conversación pero no escribir aquí.</div>
      )}
    </div>
  );
}
