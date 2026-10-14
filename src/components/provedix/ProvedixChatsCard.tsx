"use client";

import { useEffect, useState } from "react";
import type { ProvedixChatRow } from "@/lib/provedixTraffic";

// Conversaciones con Michelle, la asistente virtual de provedix.com
// (2026-10-15) — SOLO el admin. Sirve para ver qué preguntan los
// dropshippers y revisar que Michelle responda bien.

function when(iso: string) {
  return new Date(iso).toLocaleString("es-EC", { timeZone: "America/Guayaquil", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function Conversation({ chatId }: { chatId: string }) {
  const [data, setData] = useState<{ role: string; content: string; at: string }[] | null | "error">(null);
  useEffect(() => {
    let alive = true;
    fetch(`/api/provedix/chats/${chatId}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => alive && setData(d))
      .catch(() => alive && setData("error"));
    return () => {
      alive = false;
    };
  }, [chatId]);
  if (data === null) return <div className="text-[12px] text-steel">Cargando conversación…</div>;
  if (data === "error") return <div className="text-[12px] text-red">No se pudo cargar la conversación. Intenta de nuevo.</div>;
  return (
    <div className="flex flex-col gap-2 max-h-[420px] overflow-y-auto pr-1">
      {data.map((m, i) => (
        <div key={i} className={`max-w-[85%] rounded-lg px-3 py-2 text-[12.5px] whitespace-pre-wrap ${m.role === "user" ? "self-end bg-ink text-bg" : "self-start bg-surface border border-rule"}`}>
          <div className={`text-[10.5px] mb-0.5 ${m.role === "user" ? "text-bg opacity-70" : "text-steel"}`}>
            {m.role === "user" ? "Dropshipper" : "Michelle (IA)"} · {when(m.at)}
          </div>
          {m.content.replace("[[ASESORA]]", "→ pasó a Michelle por WhatsApp")}
        </div>
      ))}
    </div>
  );
}

export function ProvedixChatsCard({ chats }: { chats: ProvedixChatRow[] }) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div className="bg-surface border border-rule rounded-lg p-5 mb-7">
      <div className="text-[13px] font-semibold">Conversaciones con Michelle</div>
      <div className="text-[11px] text-steel mb-3">
        Lo que los dropshippers le preguntan a la asistente virtual en provedix.com (las últimas 60). Solo la ves tú. Toca una para leerla completa.
      </div>
      {chats.length === 0 ? (
        <div className="text-[12px] text-steel">Todavía nadie ha escrito en el chat.</div>
      ) : (
        <div className="flex flex-col">
          {chats.map((c) => (
            <div key={c.id} className="border-t border-rule">
              <button type="button" onClick={() => setOpen(open === c.id ? null : c.id)} className={`w-full text-left py-2 px-1 flex items-start gap-3 hover:bg-cloud cursor-pointer ${open === c.id ? "bg-cloud" : ""}`}>
                <div className="min-w-0 flex-1">
                  <div className="text-[12.5px] font-medium">
                    {c.who}
                    {c.whatsapp && <span className="text-steel font-normal tabular-nums"> · {c.whatsapp}</span>}
                  </div>
                  {c.lastQuestion && <div className="text-[12px] text-steel truncate">&ldquo;{c.lastQuestion}&rdquo;</div>}
                </div>
                <div className="text-right shrink-0 text-[11px] text-steel tabular-nums">
                  <div>{when(c.updatedAt)}</div>
                  <div>{c.messages} mensajes</div>
                </div>
              </button>
              {open === c.id && (
                <div className="bg-cloud px-3 pb-4 pt-1">
                  <Conversation chatId={c.id} />
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
