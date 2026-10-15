"use client";

import { useEffect, useRef, useState } from "react";
import { Check, FileText, Trash2, Upload } from "lucide-react";
import { uploadFile } from "@/lib/uploadFile";
import { formatDateTime } from "@/lib/formatDateTime";

type Guide = {
  id: string;
  guideNumber: string;
  fileUrl: string;
  fileName: string | null;
  comment: string | null;
  createdAt: string;
  uploadedById: string;
  uploadedByName: string | null;
  handledAt: string | null;
  handledByName: string | null;
  verifiedAt: string | null;
  verifiedByName: string | null;
};
type Role = { userId: string; canUpload: boolean; canHandle: boolean; canVerify: boolean; isAdmin: boolean };

// Garantías por despachar (pedido de Daniel 2026-10-14): Michelle y Yair
// suben la guía + comentario; Joao marca el visto y saca la guía; Daniel o
// Allan revisan que esté correcto. Ver src/lib/warrantyDispatch.ts.
export function WarrantyDispatchPanel() {
  const [role, setRole] = useState<Role | null>(null);
  const [guides, setGuides] = useState<Guide[] | null>(null);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  function load() {
    fetch("/api/warranty-dispatch-guides")
      .then((r) => r.json())
      .then((d) => {
        setRole(d?.role ?? null);
        setGuides(Array.isArray(d?.guides) ? d.guides : []);
      })
      .catch(() => setGuides([]));
  }
  useEffect(load, []);

  async function act(id: string, action: "handle" | "unhandle" | "verify") {
    setBusyId(id);
    setError("");
    const res = await fetch(`/api/warranty-dispatch-guides/${id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
    const d = await res.json().catch(() => null);
    if (!res.ok) setError(d?.error ?? "No se pudo guardar.");
    setBusyId(null);
    load();
  }

  async function remove(id: string) {
    if (!window.confirm("¿Quitar esta guía de la lista?")) return;
    setBusyId(id);
    setError("");
    const res = await fetch(`/api/warranty-dispatch-guides/${id}`, { method: "DELETE" });
    const d = await res.json().catch(() => null);
    if (!res.ok) setError(d?.error ?? "No se pudo quitar.");
    setBusyId(null);
    load();
  }

  if (guides === null) return <div className="text-[13px] text-steel">Cargando…</div>;

  const pending = guides.filter((g) => !g.verifiedAt);
  const done = guides.filter((g) => g.verifiedAt);

  return (
    <div className="flex flex-col gap-6 max-w-2xl">
      {role?.canUpload && (
        <a href="/area/arreglos-garantia" className="self-start text-[12px] font-semibold text-blue">
          Reenvío pagado por el dropshipper o arreglo en dinero → Arreglos de garantía
        </a>
      )}
      {role?.canUpload && <UploadForm onSent={load} />}
      {error && <div className="text-red text-[12px]">{error}</div>}

      <div>
        <div className="font-display font-bold text-[14px] mb-2.5">Por despachar ({pending.length})</div>
        {pending.length === 0 ? (
          <div className="text-[13px] text-steel">No hay garantías pendientes.</div>
        ) : (
          <div className="flex flex-col gap-2.5">
            {pending.map((g) => (
              <GuideCard key={g.id} g={g} role={role} busy={busyId === g.id} onAct={act} onRemove={remove} />
            ))}
          </div>
        )}
      </div>

      {done.length > 0 && (
        <div>
          <div className="font-display font-bold text-[14px] mb-2.5">Revisadas (últimos 30 días)</div>
          <div className="flex flex-col gap-2.5">
            {done.map((g) => (
              <GuideCard key={g.id} g={g} role={role} busy={false} onAct={act} onRemove={remove} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function GuideCard({
  g,
  role,
  busy,
  onAct,
  onRemove,
}: {
  g: Guide;
  role: Role | null;
  busy: boolean;
  onAct: (id: string, action: "handle" | "unhandle" | "verify") => void;
  onRemove: (id: string) => void;
}) {
  const canToggle = !!role?.canHandle && !g.verifiedAt && !busy;
  const canRemove = !g.handledAt && (g.uploadedById === role?.userId || role?.isAdmin);
  return (
    <div className="bg-surface border border-rule rounded-md p-3.5 flex gap-3">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap mb-1">
          <span className="font-mono text-[13px] font-bold text-teal">{g.guideNumber}</span>
          <a href={g.fileUrl} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-[11px] font-semibold text-blue">
            <FileText size={12} /> Ver guía
          </a>
        </div>
        <div className="text-[11px] text-steel mb-1.5">Subida por {g.uploadedByName} · {formatDateTime(g.createdAt)}</div>
        {g.comment ? (
          <div className="text-[12.5px] whitespace-pre-wrap bg-cloud rounded-md p-2.5 mb-1.5">{g.comment}</div>
        ) : (
          <div className="text-[11.5px] text-steel italic mb-1.5">Sin comentario.</div>
        )}
        {g.verifiedAt ? (
          <div className="text-[11px] text-green font-semibold">Revisado por {g.verifiedByName} · {formatDateTime(g.verifiedAt)}</div>
        ) : g.handledAt ? (
          role?.canVerify ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => onAct(g.id, "verify")}
              className="mt-1 rounded border border-teal bg-teal px-3 py-1.5 text-[11.5px] font-bold text-navy cursor-pointer disabled:opacity-60"
            >
              {busy ? "Guardando…" : "Correcto ✓"}
            </button>
          ) : (
            <div className="text-[11px] text-steel">Esperando revisión de Daniel o Allan.</div>
          )
        ) : (
          canRemove && (
            <button type="button" disabled={busy} onClick={() => onRemove(g.id)} className="flex items-center gap-1 text-[11px] text-red cursor-pointer disabled:opacity-60">
              <Trash2 size={12} /> Quitar
            </button>
          )
        )}
      </div>

      {/* Recuadro del visto: lo marca Joao; muestra quién la gestiona. */}
      <div className="flex flex-col items-center gap-1 w-24 shrink-0 text-center">
        <button
          type="button"
          disabled={!canToggle}
          onClick={() => onAct(g.id, g.handledAt ? "unhandle" : "handle")}
          title={role?.canHandle ? (g.handledAt ? "Quitar el visto" : "Marcar que la gestiono") : undefined}
          className={`w-7 h-7 rounded border-2 flex items-center justify-center ${g.handledAt ? "bg-teal border-teal text-navy" : "border-rule"} ${canToggle ? "cursor-pointer hover:border-teal" : "cursor-default"}`}
        >
          {g.handledAt && <Check size={16} strokeWidth={3} />}
        </button>
        {g.handledAt ? (
          <div className="text-[10px] leading-tight text-steel">
            Gestionando:
            <br />
            <span className="font-semibold text-ink">{g.handledByName}</span>
          </div>
        ) : (
          <div className="text-[10px] leading-tight text-steel">{role?.canHandle ? "Marcar" : "Sin tomar"}</div>
        )}
      </div>
    </div>
  );
}

function UploadForm({ onSent }: { onSent: () => void }) {
  const [guideNumber, setGuideNumber] = useState("");
  const [comment, setComment] = useState("");
  const [file, setFile] = useState<{ url: string; name: string } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  async function pick(list: FileList | null) {
    const f = list?.[0];
    if (!f) return;
    setErr("");
    setUploading(true);
    const up = await uploadFile(f, "warranty-dispatch-guides");
    setUploading(false);
    if (!up.ok) {
      setErr(up.error);
      return;
    }
    setFile({ url: up.url, name: f.name });
  }

  async function send() {
    setErr("");
    if (guideNumber.trim().length < 3) return setErr("Escribe el número de guía.");
    if (!file) return setErr("Sube la guía (PDF o foto).");
    setSaving(true);
    const res = await fetch("/api/warranty-dispatch-guides", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ guideNumber, fileUrl: file.url, fileName: file.name, comment }),
    });
    const d = await res.json().catch(() => null);
    setSaving(false);
    if (!res.ok) return setErr(d?.error ?? "No se pudo enviar.");
    setGuideNumber("");
    setComment("");
    setFile(null);
    if (inputRef.current) inputRef.current.value = "";
    onSent();
  }

  return (
    <div className="bg-surface border border-rule rounded-md p-4 flex flex-col gap-3">
      <div className="font-display font-bold text-[14px]">Subir guía de garantía autorizada</div>
      <label className="flex flex-col gap-1">
        <span className="text-[11.5px] font-semibold text-steel">Número de guía</span>
        <input
          value={guideNumber}
          onChange={(e) => setGuideNumber(e.target.value)}
          placeholder="Ej.: D002055162"
          className="bg-cloud border border-rule rounded px-2.5 py-1.5 text-[13px] font-mono"
        />
      </label>
      <div className="flex flex-col gap-1">
        <span className="text-[11.5px] font-semibold text-steel">Guía (PDF o foto)</span>
        <input ref={inputRef} type="file" accept="application/pdf,image/*" className="hidden" onChange={(e) => pick(e.target.files)} />
        <button
          type="button"
          disabled={uploading}
          onClick={() => inputRef.current?.click()}
          className="flex items-center gap-1.5 self-start rounded border border-rule px-3 py-1.5 text-[12px] font-semibold cursor-pointer disabled:opacity-60"
        >
          <Upload size={13} /> {uploading ? "Subiendo…" : file ? "Cambiar archivo" : "Elegir archivo"}
        </button>
        {file && <span className="text-[11.5px] text-green">✓ {file.name}</span>}
      </div>
      <label className="flex flex-col gap-1">
        <span className="text-[11.5px] font-semibold text-steel">Comentario (opcional)</span>
        <textarea
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          rows={3}
          placeholder="Qué se envía (completo o solo una pieza) y qué debe verse en el video. Ej.: enviar solo el cargador; en el video mostrar que enciende y que no está partido."
          className="bg-cloud border border-rule rounded px-2.5 py-1.5 text-[12.5px]"
        />
      </label>
      {err && <div className="text-red text-[11.5px]">{err}</div>}
      <button
        type="button"
        disabled={saving || uploading}
        onClick={send}
        className="self-start rounded border border-teal bg-teal px-4 py-1.5 text-[12px] font-bold text-navy cursor-pointer disabled:opacity-60"
      >
        {saving ? "Enviando…" : "Enviar a bodega"}
      </button>
    </div>
  );
}
