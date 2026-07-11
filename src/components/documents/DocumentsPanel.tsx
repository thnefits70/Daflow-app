"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, Pencil, Download, Upload, X, FileText } from "lucide-react";

type DocumentDTO = {
  id: string;
  title: string;
  content: string;
  link: string;
  fileUrl: string | null;
  fileName: string | null;
};

export function DocumentsPanel({
  deptId,
  isLaw,
  documents,
  editable,
  canDelete,
}: {
  deptId?: string;
  isLaw?: boolean;
  documents: DocumentDTO[];
  editable: boolean;
  canDelete?: boolean;
}) {
  const allowDelete = canDelete ?? editable;
  const router = useRouter();
  const [openId, setOpenId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<DocumentDTO | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const create = async () => {
    setBusy(true);
    const res = await fetch("/api/documents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Nuevo documento", deptId: deptId ?? null, isLaw: !!isLaw }),
    });
    setBusy(false);
    if (!res.ok) return;
    const created = await res.json();
    setEditingId(created.id);
    setDraft({ id: created.id, title: created.title, content: "", link: "", fileUrl: null, fileName: null });
    router.refresh();
  };

  const startEdit = (d: DocumentDTO) => {
    setEditingId(d.id);
    setDraft({ ...d });
    setErr("");
  };

  const save = async () => {
    if (!draft) return;
    setBusy(true);
    await fetch(`/api/documents/${draft.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: draft.title,
        content: draft.content,
        link: draft.link,
        fileUrl: draft.fileUrl,
        fileName: draft.fileName,
      }),
    });
    setBusy(false);
    setEditingId(null);
    setDraft(null);
    router.refresh();
  };

  const remove = async (id: string) => {
    setBusy(true);
    await fetch(`/api/documents/${id}`, { method: "DELETE" });
    setBusy(false);
    router.refresh();
  };

  const uploadPdf = async (file: File) => {
    if (!draft) return;
    setErr("");
    setBusy(true);
    const fd = new FormData();
    fd.append("file", file);
    fd.append("folder", "documents");
    const res = await fetch("/api/upload", { method: "POST", body: fd });
    setBusy(false);
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setErr(data?.error ?? "No se pudo subir el archivo.");
      return;
    }
    const data = await res.json();
    setDraft({ ...draft, fileUrl: data.url, fileName: data.name });
  };

  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-4">
        <div className="text-[13px] text-steel">
          Notas, PDFs o enlaces de referencia. Los PDF se leen aquí mismo, sin descargar.
        </div>
        {editable && (
          <button
            type="button"
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded border border-blue bg-blue px-3.5 py-2 text-[12.5px] font-semibold text-white cursor-pointer disabled:opacity-60"
            onClick={create}
          >
            <Plus size={14} /> Nuevo documento
          </button>
        )}
      </div>

      {documents.length === 0 && (
        <div className="border-[1.5px] border-dashed border-rule rounded-md p-8.5 text-center text-steel text-[13.5px]">
          Aún no hay documentos.
        </div>
      )}

      {documents.map((d) => (
        <div key={d.id} className="bg-surface border border-rule rounded p-4.5 mb-2.5">
          {editingId === d.id && draft ? (
            <div>
              <div className="mb-2.5">
                <label className="block mb-1 text-[10.5px] font-semibold uppercase tracking-wide text-steel">Título</label>
                <input
                  className="w-full rounded border border-rule px-2.5 py-2 text-[13.5px]"
                  value={draft.title}
                  onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                />
              </div>
              <div className="mb-2.5">
                <label className="block mb-1 text-[10.5px] font-semibold uppercase tracking-wide text-steel">
                  Contenido (opcional)
                </label>
                <textarea
                  className="w-full rounded border border-rule px-2.5 py-2 text-[13.5px]"
                  rows={4}
                  value={draft.content}
                  onChange={(e) => setDraft({ ...draft, content: e.target.value })}
                />
              </div>
              <div className="mb-2.5">
                <label className="block mb-1 text-[10.5px] font-semibold uppercase tracking-wide text-steel">
                  Enlace externo (opcional)
                </label>
                <input
                  className="w-full rounded border border-rule px-2.5 py-2 text-[13.5px]"
                  placeholder="https://…"
                  value={draft.link}
                  onChange={(e) => setDraft({ ...draft, link: e.target.value })}
                />
              </div>
              <div className="mb-3">
                <label className="block mb-1 text-[10.5px] font-semibold uppercase tracking-wide text-steel">
                  Archivo PDF (opcional)
                </label>
                {draft.fileUrl ? (
                  <div className="flex items-center justify-between gap-2 border border-rule rounded px-2.5 py-2">
                    <span className="text-[13px] flex items-center gap-1.5"><FileText size={13} /> {draft.fileName}</span>
                    <button type="button" className="text-steel hover:text-red cursor-pointer" onClick={() => setDraft({ ...draft, fileUrl: null, fileName: null })}>
                      <X size={14} />
                    </button>
                  </div>
                ) : (
                  <label className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold border border-rule rounded px-3 py-2 cursor-pointer">
                    <Upload size={13} /> {busy ? "Subiendo…" : "Subir PDF"}
                    <input
                      type="file"
                      accept="application/pdf"
                      className="hidden"
                      disabled={busy}
                      onChange={(e) => e.target.files?.[0] && uploadPdf(e.target.files[0])}
                    />
                  </label>
                )}
                {err && <div className="text-red text-[12px] mt-1.5">{err}</div>}
              </div>
              <div className="flex items-center gap-2.5">
                <button type="button" disabled={busy} className="rounded border border-blue bg-blue px-4 py-2 text-[13px] font-semibold text-white cursor-pointer" onClick={save}>
                  Guardar
                </button>
                <button type="button" className="text-steel text-[13px] cursor-pointer" onClick={() => { setEditingId(null); setDraft(null); }}>
                  Cancelar
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="font-semibold text-[14.5px] mb-0.5">{d.title}</div>
                  {d.link && (
                    <a href={d.link} target="_blank" rel="noreferrer" className="text-[12.5px] text-blue">
                      {d.link}
                    </a>
                  )}
                  {d.content && !d.link && <div className="text-[12.5px] text-steel">{d.content.slice(0, 100)}</div>}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {d.fileUrl && (
                    <>
                      <button
                        type="button"
                        className="text-[12px] font-semibold border border-rule rounded px-2.5 py-1.5 cursor-pointer"
                        onClick={() => setOpenId(openId === d.id ? null : d.id)}
                      >
                        {openId === d.id ? "Ocultar" : "Ver PDF"}
                      </button>
                      <a href={d.fileUrl} download={d.fileName || "documento.pdf"} className="text-steel hover:text-ink">
                        <Download size={15} />
                      </a>
                    </>
                  )}
                  {editable && (
                    <button type="button" className="text-steel hover:text-ink cursor-pointer" onClick={() => startEdit(d)}>
                      <Pencil size={15} />
                    </button>
                  )}
                  {allowDelete && (
                    <button type="button" className="text-steel hover:text-red cursor-pointer" onClick={() => remove(d.id)}>
                      <Trash2 size={15} />
                    </button>
                  )}
                </div>
              </div>
              {d.fileUrl && openId === d.id && (
                <iframe src={d.fileUrl} title={d.title} className="w-full border border-rule rounded mt-3.5" style={{ height: 520 }} />
              )}
            </>
          )}
        </div>
      ))}
    </div>
  );
}
