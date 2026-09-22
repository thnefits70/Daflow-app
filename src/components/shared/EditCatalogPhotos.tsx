"use client";

import { useState } from "react";
import { Camera, X } from "lucide-react";
import { uploadFile } from "@/lib/uploadFile";
import { compressImage } from "@/lib/compressImage";
import { usePasteFile } from "@/lib/usePasteFile";

export type EditedCatalogPhotos = { id: string; photos: string[] };

// Confirmado 2026-09-22: caso real de Jariel (producto #129252) — subió mal
// las fotos de un producto ya guardado y no había forma de corregirlas sin
// borrar todo el producto y volver a crearlo. Mientras no tenga compras
// registradas, el servidor deja que cualquiera de Compras reemplace las
// fotos (ver PATCH en /api/purchase-catalog/[id]/route.ts); si ya tiene
// compras registradas, ni este modal se ofrece — ver canEditPhotos en
// PurchaseCatalogPicker.
export function EditCatalogPhotos({
  item,
  onDone,
  onCancel,
}: {
  item: { id: string; name: string; photos: string[] };
  onDone: (item: EditedCatalogPhotos) => void;
  onCancel: () => void;
}) {
  const [photos, setPhotos] = useState<string[]>(item.photos);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const { onPaste: onPastePhoto, onMouseEnter: onPasteHoverIn, onMouseLeave: onPasteHoverOut } = usePasteFile((file) => addPhotos([file]));

  async function addPhotos(files: File[]) {
    const toAdd = files.filter((f) => f.type.startsWith("image/")).slice(0, Math.max(0, 3 - photos.length));
    if (toAdd.length === 0) return;
    setUploadingPhoto(true);
    setErr("");
    for (const file of toAdd) {
      const compressed = await compressImage(file);
      const uploaded = await uploadFile(compressed, "purchase-catalog");
      if (!uploaded.ok) {
        setErr(uploaded.error);
        break;
      }
      setPhotos((p) => [...p, uploaded.url]);
    }
    setUploadingPhoto(false);
  }

  async function save() {
    if (photos.length < 3) {
      setErr("Se necesitan mínimo 3 fotos.");
      return;
    }
    setSaving(true);
    setErr("");
    let res: Response;
    try {
      res = await fetch(`/api/purchase-catalog/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ photos }),
      });
    } catch {
      setSaving(false);
      setErr("No se pudo guardar — revisa tu conexión e intenta de nuevo.");
      return;
    }
    setSaving(false);
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      setErr(data?.error ?? "No se pudieron guardar las fotos.");
      return;
    }
    onDone({ id: item.id, photos: data.photos });
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onCancel}>
      <div className="bg-surface border border-rule rounded-md p-4 max-w-sm w-full" onClick={(e) => e.stopPropagation()}>
        <div className="font-display font-bold text-[14.5px] mb-1">Editar fotos</div>
        <div className="text-[12.5px] text-steel mb-3">
          <b className="text-ink">{item.name}</b> — quita las fotos incorrectas y agrega las que hagan falta (mínimo 3).
        </div>

        <div className="flex gap-2 mb-3">
          {photos.map((p, i) => (
            <div key={i} className="relative">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p} alt="" className="w-16 h-16 rounded object-cover border border-rule" />
              <button
                type="button"
                title="Quitar esta foto"
                className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-red text-white flex items-center justify-center cursor-pointer"
                onClick={() => setPhotos((ps) => ps.filter((_, idx) => idx !== i))}
              >
                <X size={11} />
              </button>
            </div>
          ))}
          {photos.length < 3 && (
            <label
              tabIndex={0}
              onPaste={onPastePhoto}
              onMouseEnter={onPasteHoverIn}
              onMouseLeave={onPasteHoverOut}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                addPhotos(Array.from(e.dataTransfer.files));
              }}
              title="Pasa el mouse y Ctrl+V para pegar, o arrastra varias fotos aquí"
              className={`w-16 h-16 rounded border-[1.5px] border-dashed flex items-center justify-center cursor-pointer text-steel hover:border-teal focus:border-teal focus:outline-none ${dragOver ? "border-teal bg-teal/10" : "border-rule"}`}
            >
              {uploadingPhoto ? (
                <span className="w-4 h-4 rounded-full border-2 border-rule border-t-teal animate-spin" />
              ) : (
                <Camera size={18} />
              )}
              <input
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={(e) => e.target.files && addPhotos(Array.from(e.target.files))}
              />
            </label>
          )}
        </div>
        <div className="text-[11px] text-steel mb-3">Real si lo tienes físicamente; referencial del proveedor si no — que se vea el producto exacto.</div>

        {err && <div className="text-red text-[12px] mb-2.5">{err}</div>}
        <div className="flex items-center gap-2.5">
          <button
            type="button"
            disabled={saving || uploadingPhoto || photos.length < 3}
            className="rounded border border-teal bg-teal px-3.5 py-2 text-[12.5px] font-bold text-navy cursor-pointer disabled:opacity-60"
            onClick={save}
          >
            {saving ? "Guardando…" : "Guardar"}
          </button>
          <button type="button" className="text-steel text-[12.5px] cursor-pointer" onClick={onCancel}>
            Cancelar
          </button>
        </div>
      </div>
    </div>
  );
}
