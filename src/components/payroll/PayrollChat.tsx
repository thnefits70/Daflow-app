"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Send, Paperclip, Search, X, FileText, Loader2 } from "lucide-react";
import { uploadFile } from "@/lib/uploadFile";

type ChatMessage = {
  id: string;
  senderId: string;
  senderName: string;
  body: string;
  attachmentUrl: string | null;
  attachmentName: string | null;
  attachmentType: string | null;
  createdAt: string;
};

function sameDay(iso: string, ymd: string) {
  const d = new Date(iso);
  const local = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return local === ymd;
}

function Attachment({ url, name, type }: { url: string; name: string; type: string | null }) {
  const isImage = (type ?? "").startsWith("image/");
  if (isImage) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={url} alt={name} className="max-w-[200px] max-h-[200px] rounded-md mt-1 block" />
    );
  }
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="mt-1 flex items-center gap-2 rounded-md bg-black/5 px-2.5 py-2 hover:bg-black/10"
    >
      <FileText size={16} className="shrink-0" />
      <span className="text-[11.5px] underline break-all">{name}</span>
    </a>
  );
}

export function PayrollChat({ employeeId, canSend }: { employeeId: string; canSend: boolean }) {
  const [messages, setMessages] = useState<ChatMessage[] | null>(null);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState("");
  const [pendingFile, setPendingFile] = useState<{ url: string; name: string; type: string } | null>(null);
  const [showSearch, setShowSearch] = useState(false);
  const [searchText, setSearchText] = useState("");
  const [searchDate, setSearchDate] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const load = () => {
    fetch(`/api/payroll-messages/${employeeId}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data) setMessages(data);
      })
      .catch(() => {});
  };

  useEffect(load, [employeeId]);

  const filtered = useMemo(() => {
    if (!messages) return messages;
    if (!searchText.trim() && !searchDate) return messages;
    const keyword = searchText.trim().toLowerCase();
    return messages.filter((m) => {
      const matchesText = !keyword || m.body.toLowerCase().includes(keyword) || (m.attachmentName ?? "").toLowerCase().includes(keyword);
      const matchesDate = !searchDate || sameDay(m.createdAt, searchDate);
      return matchesText && matchesDate;
    });
  }, [messages, searchText, searchDate]);

  const searching = showSearch && (searchText.trim() !== "" || searchDate !== "");

  const handleFilePick = async (file: File) => {
    setErr("");
    setUploading(true);
    const result = await uploadFile(file, "payroll-message-attachments");
    setUploading(false);
    if (!result.ok) {
      setErr(result.error);
      return;
    }
    setPendingFile({ url: result.url, name: result.name, type: file.type });
  };

  const send = async () => {
    if (!text.trim() && !pendingFile) return;
    setSending(true);
    setErr("");
    const res = await fetch(`/api/payroll-messages/${employeeId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        body: text.trim(),
        attachmentUrl: pendingFile?.url,
        attachmentName: pendingFile?.name,
        attachmentType: pendingFile?.type,
      }),
    });
    setSending(false);
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setErr(data?.error ?? "No se pudo enviar el mensaje.");
      return;
    }
    setText("");
    setPendingFile(null);
    load();
  };

  return (
    <div className="mt-2.5 border border-rule rounded-md bg-cloud p-3">
      <div className="flex items-center justify-between mb-1.5">
        <button
          type="button"
          onClick={() => {
            setShowSearch((s) => !s);
            if (showSearch) {
              setSearchText("");
              setSearchDate("");
            }
          }}
          className="flex items-center gap-1 text-[11px] text-steel hover:text-ink cursor-pointer"
        >
          <Search size={12} /> {showSearch ? "Cerrar búsqueda" : "Buscar en el chat"}
        </button>
        {searching && filtered && (
          <span className="text-[10.5px] text-steel">
            {filtered.length} resultado{filtered.length === 1 ? "" : "s"}
          </span>
        )}
      </div>

      {showSearch && (
        <div className="flex gap-2 mb-2">
          <input
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            placeholder="Buscar palabra clave…"
            className="flex-1 bg-surface border border-rule rounded px-2.5 py-1.5 text-[12px]"
          />
          <input
            type="date"
            value={searchDate}
            onChange={(e) => setSearchDate(e.target.value)}
            className="bg-surface border border-rule rounded px-2 py-1.5 text-[12px]"
          />
        </div>
      )}

      <div className="max-h-64 overflow-y-auto space-y-2 mb-2.5">
        {messages === null && <div className="text-steel text-[12px]">Cargando…</div>}
        {messages?.length === 0 && <div className="text-steel text-[12px]">Sin mensajes todavía.</div>}
        {searching && filtered?.length === 0 && <div className="text-steel text-[12px]">No se encontraron mensajes.</div>}
        {filtered?.map((m) => {
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
                {m.body && <div className="whitespace-pre-wrap break-words">{m.body}</div>}
                {m.attachmentUrl && <Attachment url={m.attachmentUrl} name={m.attachmentName ?? "Archivo"} type={m.attachmentType} />}
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
        <div>
          {pendingFile && (
            <div className="flex items-center gap-2 mb-1.5 bg-surface border border-rule rounded px-2.5 py-1.5">
              {pendingFile.type.startsWith("image/") ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={pendingFile.url} alt={pendingFile.name} className="w-8 h-8 object-cover rounded shrink-0" />
              ) : (
                <FileText size={14} className="shrink-0" />
              )}
              <span className="text-[11px] flex-1 truncate">{pendingFile.name}</span>
              <button type="button" onClick={() => setPendingFile(null)} className="text-steel hover:text-red cursor-pointer">
                <X size={13} />
              </button>
            </div>
          )}
          <div className="flex gap-2">
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleFilePick(file);
                e.target.value = "";
              }}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              title="Adjuntar archivo o imagen"
              className="px-2.5 py-1.5 rounded border border-rule bg-surface text-steel hover:text-ink cursor-pointer disabled:opacity-50"
            >
              {uploading ? <Loader2 size={14} className="animate-spin" /> : <Paperclip size={14} />}
            </button>
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && send()}
              placeholder="Escribe un mensaje…"
              className="flex-1 bg-surface border border-rule rounded px-2.5 py-1.5 text-[12.5px]"
            />
            <button
              type="button"
              disabled={sending || uploading || (!text.trim() && !pendingFile)}
              onClick={send}
              className="px-3 py-1.5 rounded bg-blue text-white text-[12px] font-semibold cursor-pointer disabled:opacity-50 flex items-center gap-1"
            >
              <Send size={13} /> Enviar
            </button>
          </div>
        </div>
      ) : (
        <div className="text-[11px] text-steel italic">Solo lectura — puedes ver la conversación pero no escribir aquí.</div>
      )}
    </div>
  );
}
