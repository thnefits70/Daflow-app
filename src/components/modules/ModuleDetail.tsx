"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Pencil, Check, X, Upload } from "lucide-react";
import { DocumentsPanel } from "@/components/documents/DocumentsPanel";
import { ModuleExamPanel } from "@/components/modules/ModuleExamPanel";
import { uploadFile } from "@/lib/uploadFile";
import { iconForModule } from "@/lib/moduleIcons";

type ModuleDocumentDTO = {
  id: string;
  title: string;
  content: string;
  link: string;
  fileUrl: string | null;
  fileName: string | null;
};

export function ModuleDetail({
  module: mod,
  documents,
  editable,
  basePath,
}: {
  module: {
    id: string;
    title: string;
    imageUrl: string | null;
    exam: { id: string; title: string; questionCount: number } | null;
  };
  documents: ModuleDocumentDTO[];
  editable: boolean;
  basePath: string;
}) {
  const router = useRouter();
  const [editingTitle, setEditingTitle] = useState(false);
  const [title, setTitle] = useState(mod.title);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const saveTitle = async () => {
    const trimmed = title.trim();
    if (!trimmed) return;
    setBusy(true);
    await fetch(`/api/modules/${mod.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: trimmed }),
    });
    setBusy(false);
    setEditingTitle(false);
    router.refresh();
  };

  const uploadImage = async (file: File) => {
    setErr("");
    setBusy(true);
    const result = await uploadFile(file, "modules");
    if (!result.ok) {
      setBusy(false);
      setErr(result.error);
      return;
    }
    await fetch(`/api/modules/${mod.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ imageUrl: result.url, imageName: result.name }),
    });
    setBusy(false);
    router.refresh();
  };

  const { Icon: ModuleIcon, color: moduleIconColor } = iconForModule(mod.title);

  return (
    <div>
      <Link href={basePath} className="inline-flex items-center gap-1.5 text-[13px] text-steel hover:text-ink mb-4.5">
        <ArrowLeft size={14} /> Volver a módulos
      </Link>

      <div className="flex items-start gap-4 mb-6">
        <div className="w-32 h-24 shrink-0 bg-cloud border border-rule rounded-md overflow-hidden flex items-center justify-center relative group">
          {mod.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={mod.imageUrl} alt={mod.title} className="w-full h-full object-cover" />
          ) : (
            <ModuleIcon size={26} style={{ color: moduleIconColor }} strokeWidth={1.75} />
          )}
          {editable && (
            <label className="absolute inset-0 flex items-center justify-center bg-navy/60 text-white opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer text-[11px] gap-1">
              <Upload size={13} /> {busy ? "Subiendo…" : "Cambiar"}
              <input
                type="file"
                accept="image/*"
                className="hidden"
                disabled={busy}
                onChange={(e) => e.target.files?.[0] && uploadImage(e.target.files[0])}
              />
            </label>
          )}
        </div>

        <div className="flex-1 min-w-0">
          {editingTitle ? (
            <div className="flex items-center gap-2">
              <input
                className="flex-1 rounded border border-rule px-2.5 py-2 text-[18px] font-display font-bold"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                autoFocus
              />
              <button type="button" disabled={busy} className="text-blue cursor-pointer" onClick={saveTitle}>
                <Check size={18} />
              </button>
              <button
                type="button"
                className="text-steel cursor-pointer"
                onClick={() => {
                  setTitle(mod.title);
                  setEditingTitle(false);
                }}
              >
                <X size={18} />
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <h1 className="font-display text-[20px] font-bold">{mod.title}</h1>
              {editable && (
                <button type="button" className="text-steel hover:text-ink cursor-pointer" onClick={() => setEditingTitle(true)}>
                  <Pencil size={15} />
                </button>
              )}
            </div>
          )}
          {err && <div className="text-red text-[12px] mt-1.5">{err}</div>}
        </div>
      </div>

      <h3 className="text-[14px] font-semibold mb-3">Contenido</h3>
      <DocumentsPanel moduleId={mod.id} documents={documents} editable={editable} />

      <h3 className="text-[14px] font-semibold mt-7 mb-3">Examen</h3>
      <ModuleExamPanel moduleId={mod.id} exam={mod.exam} editable={editable} />
    </div>
  );
}
