"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { ProvedixChatRow } from "@/lib/provedixTraffic";

// Conversaciones con Michelle, la asistente virtual de provedix.com
// (2026-10-15) — SOLO el admin. Sirve para ver qué preguntan los
// dropshippers y revisar que Michelle responda bien. Desde 2026-10-14
// Michelle cierra el chat y bloquea a quien intenta sacarle información
// confidencial; acá se ve "Bloqueado" y el admin puede desbloquear.

function when(iso: string) {
  return new Date(iso).toLocaleString("es-EC", {
    timeZone: "America/Guayaquil",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const tidy = (t: string) =>
  t
    .replace(/\[\[ASESORA(:([A-Z0-9-]+))?\]\]/g, (_m, _c, code) => `→ pasó a Michelle (asesora)${code ? ` · caso ${code}` : ""}`)
    .replace("[[BLOQUEAR]]", "→ cerró el chat")
    .replace("[[SOSPECHA]]", "→ ⚠️ le pareció raro")
    .replace(/\[\[FOTO:\w+\]\]/g, "[📸 foto de la guía retenida]")
    .replace(/\[\[(DROPI|CREATIVOS|LANDING):(\d+)\]\]/g, "[botón $1 · $2]");

const SYSTEM_ICON: Record<string, string> = {
  blocked: "🔒",
  unblocked: "🔓",
  blocked_24h: "⏳",
  guide_fail: "❌",
  flag: "⚠️",
  reviewed: "✓",
};

function Conversation({ chatId }: { chatId: string }) {
  const [data, setData] = useState<
    { role: string; content: string; at: string }[] | null | "error"
  >(null);
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
  if (data === null)
    return <div className="text-[12px] text-steel">Cargando conversación…</div>;
  if (data === "error")
    return (
      <div className="text-[12px] text-red">
        No se pudo cargar la conversación. Intenta de nuevo.
      </div>
    );
  return (
    <div className="flex flex-col gap-2 max-h-[420px] overflow-y-auto pr-1">
      {data.map((m, i) =>
        m.role !== "user" && m.role !== "assistant" ? (
          <div
            key={i}
            className={`self-center text-[11.5px] font-semibold ${m.role === "reviewed" || m.role === "unblocked" ? "text-steel" : "text-red"}`}
          >
            {SYSTEM_ICON[m.role] ?? "•"} {m.content} · {when(m.at)}
          </div>
        ) : (
          <div
            key={i}
            className={`max-w-[85%] rounded-lg px-3 py-2 text-[12.5px] whitespace-pre-wrap ${m.role === "user" ? "self-end bg-ink text-bg" : "self-start bg-surface border border-rule"}`}
          >
            <div
              className={`text-[10.5px] mb-0.5 ${m.role === "user" ? "text-bg opacity-70" : "text-steel"}`}
            >
              {m.role === "user" ? "Dropshipper" : "Michelle (IA)"} ·{" "}
              {when(m.at)}
            </div>
            {tidy(m.content)}
          </div>
        ),
      )}
    </div>
  );
}

function ActionButton({
  chatId,
  action,
  label,
  busyLabel,
  confirmText,
}: {
  chatId: string;
  action: "unblock" | "reviewed";
  label: string;
  busyLabel: string;
  confirmText?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      disabled={busy}
      onClick={async () => {
        if (confirmText && !confirm(confirmText)) return;
        setBusy(true);
        const res = await fetch(`/api/provedix/chats/${chatId}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action }),
        }).catch(() => null);
        setBusy(false);
        if (res?.ok) router.refresh();
        else alert("No se pudo guardar. Intenta de nuevo.");
      }}
      className="text-[11.5px] font-semibold border border-rule rounded-md px-2.5 py-1 hover:bg-surface cursor-pointer disabled:opacity-50"
    >
      {busy ? busyLabel : label}
    </button>
  );
}

export function ProvedixChatsCard({ chats }: { chats: ProvedixChatRow[] }) {
  const [open, setOpen] = useState<string | null>(null);
  const pendingCount = chats.filter((c) => c.pendingReview).length;
  // Desde el aviso de Inicio (#michelle) se abre directo en "Sospechosas".
  const [onlySuspicious, setOnlySuspicious] = useState(false);
  useEffect(() => {
    if (window.location.hash !== "#michelle") return;
    const t = setTimeout(() => {
      setOnlySuspicious(true);
      document
        .getElementById("michelle")
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 0);
    return () => clearTimeout(t);
  }, []);
  const shown = onlySuspicious ? chats.filter((c) => c.suspicious) : chats;
  return (
    <div
      id="michelle"
      className="bg-surface border border-rule rounded-lg p-5 mb-7 scroll-mt-4"
    >
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="text-[13px] font-semibold">
            Conversaciones con Michelle
          </div>
          <div className="text-[11px] text-steel mb-3 max-w-[720px]">
            Lo que los dropshippers le preguntan a la asistente virtual en
            provedix.com (las últimas 60). Solo la ves tú. Toca una para leerla
            completa. Si alguien intenta sacarle información confidencial,
            Michelle cierra el chat y lo bloquea. Las sospechosas sin revisar
            salen en tu Inicio.
          </div>
        </div>
        <div className="flex gap-1 text-[11.5px] font-semibold">
          <button
            type="button"
            onClick={() => setOnlySuspicious(false)}
            className={`rounded-md px-2.5 py-1 border cursor-pointer ${!onlySuspicious ? "border-ink bg-ink text-bg" : "border-rule text-steel"}`}
          >
            Todas
          </button>
          <button
            type="button"
            onClick={() => setOnlySuspicious(true)}
            className={`rounded-md px-2.5 py-1 border cursor-pointer ${onlySuspicious ? "border-ink bg-ink text-bg" : "border-rule text-steel"}`}
          >
            Sospechosas{pendingCount ? ` (${pendingCount} sin revisar)` : ""}
          </button>
        </div>
      </div>
      {shown.length === 0 ? (
        <div className="text-[12px] text-steel">
          {onlySuspicious
            ? "No hay conversaciones sospechosas."
            : "Todavía nadie ha escrito en el chat."}
        </div>
      ) : (
        <div className="flex flex-col">
          {shown.map((c) => (
            <div key={c.id} className="border-t border-rule">
              <button
                type="button"
                onClick={() => setOpen(open === c.id ? null : c.id)}
                className={`w-full text-left py-2 px-1 flex items-start gap-3 hover:bg-cloud cursor-pointer ${open === c.id ? "bg-cloud" : ""}`}
              >
                <div className="min-w-0 flex-1">
                  <div className="text-[12.5px] font-medium">
                    {c.who}
                    {c.whatsapp && (
                      <span className="text-steel font-normal tabular-nums">
                        {" "}
                        · {c.whatsapp}
                      </span>
                    )}
                    {c.blocked && (
                      <span className="ml-2 text-[10.5px] font-bold text-red">
                        🔒 BLOQUEADO
                      </span>
                    )}
                    {c.suspicious && !c.blocked && (
                      <span
                        className={`ml-2 text-[10.5px] font-bold ${c.pendingReview ? "text-red" : "text-steel"}`}
                      >
                        ⚠️{" "}
                        {c.pendingReview
                          ? "SOSPECHOSA"
                          : "Sospechosa · revisada"}
                      </span>
                    )}
                  </div>
                  {c.suspicious && (
                    <div className="text-[11px] text-red">
                      {c.reasons.join(" · ")}
                    </div>
                  )}
                  {c.lastQuestion && (
                    <div className="text-[12px] text-steel truncate">
                      &ldquo;{c.lastQuestion}&rdquo;
                    </div>
                  )}
                </div>
                <div className="text-right shrink-0 text-[11px] text-steel tabular-nums">
                  <div>{when(c.updatedAt)}</div>
                  <div>{c.messages} mensajes</div>
                </div>
              </button>
              {open === c.id && (
                <div className="bg-cloud px-3 pb-4 pt-1">
                  {(c.blocked || c.pendingReview) && (
                    <div className="mb-2 flex justify-end gap-2">
                      {c.pendingReview && (
                        <ActionButton
                          chatId={c.id}
                          action="reviewed"
                          label="✓ Marcar revisada"
                          busyLabel="Guardando…"
                        />
                      )}
                      {c.blocked && (
                        <ActionButton
                          chatId={c.id}
                          action="unblock"
                          label="Desbloquear"
                          busyLabel="Desbloqueando…"
                          confirmText="¿Desbloquear a esta persona? Podrá volver a escribirle a Michelle."
                        />
                      )}
                    </div>
                  )}
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
