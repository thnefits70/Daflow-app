"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, Pencil, FileText, Eye, Search } from "lucide-react";

function fileKind(name: string): "pdf" | "image" | "other" {
  const n = name.toLowerCase();
  if (n.endsWith(".pdf")) return "pdf";
  if (/\.(png|jpe?g|gif|webp)$/.test(n)) return "image";
  return "other";
}

type UserOption = { id: string; name: string; deptName: string | null };
type Grant = { user: { id: string; name: string } };
type DocDTO = {
  id: string;
  title: string;
  category: string | null;
  fileName: string;
  grants: Grant[];
  createdAt: string;
};
type OwnDocDTO = {
  id: string;
  title: string;
  category: string | null;
  fileName: string;
  grantedAt: string;
  seenAt: string | null;
};

function DocViewer({ id, fileName }: { id: string; fileName: string }) {
  const kind = fileKind(fileName);
  if (kind === "pdf") {
    return <iframe src={`/api/confidential-documents/${id}/view`} title={fileName} className="w-full border border-rule rounded mt-2.5" style={{ height: 520 }} />;
  }
  if (kind === "image") {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={`/api/confidential-documents/${id}/view`} alt={fileName} className="w-full rounded mt-2.5 border border-rule" />;
  }
  return <div className="text-[12px] text-steel mt-2">Este tipo de archivo no se puede previsualizar aquí.</div>;
}

const emptyForm = {
  title: "",
  category: "",
  grantedUserIds: [] as string[],
};

export function ConfidentialDocsPanel({
  mode,
  users,
}: {
  mode: "manage" | "own";
  users?: UserOption[];
}) {
  const router = useRouter();
  const [docs, setDocs] = useState<DocDTO[] | null>(null);
  const [ownDocs, setOwnDocs] = useState<OwnDocDTO[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [file, setFile] = useState<File | null>(null);
  const [userQuery, setUserQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);
  const [viewingId, setViewingId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    const res = await fetch("/api/confidential-documents");
    setLoading(false);
    if (!res.ok) return;
    const data = await res.json();
    if (data.mode === "manage") setDocs(data.docs);
    else setOwnDocs(data.docs);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startNew = () => {
    setEditingId(null);
    setForm(emptyForm);
    setFile(null);
    setFormOpen(true);
    setErr("");
  };

  const startEdit = (d: DocDTO) => {
    setEditingId(d.id);
    setForm({ title: d.title, category: d.category ?? "", grantedUserIds: d.grants.map((g) => g.user.id) });
    setFile(null);
    setFormOpen(true);
    setErr("");
  };

  const toggleUser = (userId: string) => {
    setForm((f) => ({
      ...f,
      grantedUserIds: f.grantedUserIds.includes(userId)
        ? f.grantedUserIds.filter((id) => id !== userId)
        : [...f.grantedUserIds, userId],
    }));
  };

  const save = async () => {
    if (!form.title.trim()) {
      setErr("Ponle un título al documento.");
      return;
    }
    if (!editingId && !file) {
      setErr("Selecciona un archivo (PDF o imagen).");
      return;
    }
    setErr("");
    setBusy(true);
    const fd = new FormData();
    fd.append("title", form.title.trim());
    fd.append("category", form.category.trim());
    fd.append("grantedUserIds", JSON.stringify(form.grantedUserIds));
    if (file) fd.append("file", file);

    const res = editingId
      ? await fetch(`/api/confidential-documents/${editingId}`, { method: "PATCH", body: fd })
      : await fetch("/api/confidential-documents", { method: "POST", body: fd });
    setBusy(false);
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setErr(data?.error ?? "No se pudo guardar el documento.");
      return;
    }
    setFormOpen(false);
    setEditingId(null);
    load();
    router.refresh();
  };

  const remove = async (id: string) => {
    setBusy(true);
    await fetch(`/api/confidential-documents/${id}`, { method: "DELETE" });
    setBusy(false);
    setConfirmingDeleteId(null);
    load();
    router.refresh();
  };

  const filteredUsers = (users ?? []).filter((u) => u.name.toLowerCase().includes(userQuery.toLowerCase()));

  if (mode === "own") {
    return (
      <div>
        {loading && <div className="text-steel text-[13px]">Cargando…</div>}
        {!loading && (ownDocs?.length ?? 0) === 0 && (
          <div className="border-[1.5px] border-dashed border-rule rounded-md p-8.5 text-center text-steel text-[13.5px]">
            No tienes documentos compartidos.
          </div>
        )}
        {ownDocs?.map((d) => (
          <div key={d.id} className="bg-surface border border-rule rounded p-3.5 mb-2.5">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div>
                <div className="flex items-center gap-2 font-semibold text-[13.5px]">
                  <FileText size={14} className="text-steel" /> {d.title}
                </div>
                {d.category && <div className="text-[11.5px] text-steel mt-0.5 ml-5.5">{d.category}</div>}
              </div>
              <button
                type="button"
                className="text-[12px] font-semibold border border-rule rounded px-2.5 py-1.5 cursor-pointer inline-flex items-center gap-1.5 shrink-0"
                onClick={() => setViewingId(viewingId === d.id ? null : d.id)}
              >
                <Eye size={12} /> {viewingId === d.id ? "Ocultar" : "Ver"}
              </button>
            </div>
            {viewingId === d.id && <DocViewer id={d.id} fileName={d.fileName} />}
          </div>
        ))}
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-4">
        <div className="text-[13px] text-steel">Solo tú puedes verlos, salvo que le des acceso puntual a alguien.</div>
        <button
          type="button"
          disabled={busy}
          className="inline-flex items-center gap-1.5 rounded border border-blue bg-blue px-3.5 py-2 text-[12.5px] font-semibold text-white cursor-pointer disabled:opacity-60 shrink-0"
          onClick={startNew}
        >
          <Plus size={14} /> Nuevo documento
        </button>
      </div>

      {formOpen && (
        <div className="bg-surface border border-rule rounded-md p-4.5 mb-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
            <div>
              <label className="block mb-1 text-[10.5px] font-semibold uppercase tracking-wide text-steel">Título</label>
              <input
                className="w-full rounded border border-rule px-2.5 py-2 text-[13.5px]"
                value={form.title}
                onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                placeholder="Ej. Manual de marca 2026"
              />
            </div>
            <div>
              <label className="block mb-1 text-[10.5px] font-semibold uppercase tracking-wide text-steel">Categoría (opcional)</label>
              <input
                className="w-full rounded border border-rule px-2.5 py-2 text-[13.5px]"
                value={form.category}
                onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
                placeholder="Ej. Marketing, Branding, Patentes, Procesos…"
              />
            </div>
          </div>

          <div className="mb-3">
            <label className="block mb-1 text-[10.5px] font-semibold uppercase tracking-wide text-steel">
              Archivo (PDF o imagen) {editingId && "— deja vacío para conservar el actual"}
            </label>
            <input
              type="file"
              accept=".pdf,image/*"
              className="text-[13px]"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </div>

          <div className="mb-3">
            <label className="block mb-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-steel">
              Compartir con (opcional) — solo tú lo ves si no eliges a nadie
            </label>
            <div className="relative mb-2">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-steel" />
              <input
                className="w-full rounded border border-rule pl-7.5 pr-2.5 py-1.5 text-[12.5px]"
                placeholder="Buscar persona…"
                value={userQuery}
                onChange={(e) => setUserQuery(e.target.value)}
              />
            </div>
            <div className="border border-rule rounded-md max-h-48 overflow-y-auto">
              {filteredUsers.length === 0 && (
                <div className="text-[12px] text-steel p-2.5">Sin resultados.</div>
              )}
              {filteredUsers.map((u) => (
                <label key={u.id} className="flex items-center gap-2 px-2.5 py-1.5 text-[12.5px] hover:bg-cloud cursor-pointer border-b border-rule last:border-b-0">
                  <input
                    type="checkbox"
                    checked={form.grantedUserIds.includes(u.id)}
                    onChange={() => toggleUser(u.id)}
                  />
                  <span>{u.name}</span>
                  {u.deptName && <span className="text-steel ml-auto">{u.deptName}</span>}
                </label>
              ))}
            </div>
          </div>

          {err && <div className="text-red text-[12.5px] mb-2.5">{err}</div>}
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              disabled={busy}
              className="rounded border border-blue bg-blue px-4 py-2 text-[13px] font-semibold text-white cursor-pointer disabled:opacity-60"
              onClick={save}
            >
              {busy ? "Guardando…" : editingId ? "Guardar cambios" : "Guardar"}
            </button>
            <button type="button" className="text-steel text-[13px] cursor-pointer" onClick={() => { setFormOpen(false); setEditingId(null); }}>
              Cancelar
            </button>
          </div>
        </div>
      )}

      {loading && <div className="text-steel text-[13px]">Cargando…</div>}

      {!loading && (docs?.length ?? 0) === 0 && !formOpen && (
        <div className="border-[1.5px] border-dashed border-rule rounded-md p-8.5 text-center text-steel text-[13.5px]">
          Aún no has subido ningún documento confidencial.
        </div>
      )}

      {docs?.map((d) => (
        <div key={d.id} className="bg-surface border border-rule rounded-md p-4 mb-3">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <div className="flex items-center gap-2 font-semibold text-[14px]">
                <FileText size={15} className="text-steel" /> {d.title}
              </div>
              {d.category && <div className="text-[11.5px] text-steel mt-0.5 ml-5.5">{d.category}</div>}
              <div className="text-[11.5px] text-steel mt-1 ml-5.5">
                {d.grants.length === 0
                  ? "Solo tú tienes acceso."
                  : `Compartido con ${d.grants.map((g) => g.user.name).join(", ")}`}
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                className="text-[12px] font-semibold border border-rule rounded px-2.5 py-1.5 cursor-pointer inline-flex items-center gap-1.5"
                onClick={() => setViewingId(viewingId === d.id ? null : d.id)}
              >
                <Eye size={12} /> {viewingId === d.id ? "Ocultar" : "Ver"}
              </button>
              <button type="button" className="text-steel hover:text-ink cursor-pointer" onClick={() => startEdit(d)}>
                <Pencil size={13} />
              </button>
              {confirmingDeleteId === d.id ? (
                <span className="flex items-center gap-1.5">
                  <button type="button" disabled={busy} className="text-red text-[11px] font-semibold cursor-pointer" onClick={() => remove(d.id)}>
                    Eliminar
                  </button>
                  <button type="button" className="text-steel text-[11px] cursor-pointer" onClick={() => setConfirmingDeleteId(null)}>
                    Cancelar
                  </button>
                </span>
              ) : (
                <button type="button" className="text-steel hover:text-red cursor-pointer" onClick={() => setConfirmingDeleteId(d.id)}>
                  <Trash2 size={13} />
                </button>
              )}
            </div>
          </div>
          {viewingId === d.id && <DocViewer id={d.id} fileName={d.fileName} />}
        </div>
      ))}
    </div>
  );
}
