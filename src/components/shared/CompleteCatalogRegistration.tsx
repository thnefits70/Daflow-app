"use client";

import { useState } from "react";
import { Camera, X } from "lucide-react";
import { uploadFile } from "@/lib/uploadFile";
import { compressImage } from "@/lib/compressImage";
import { usePasteFile } from "@/lib/usePasteFile";

export type CompletedCatalogItem = { id: string; name: string; photos: string[]; description?: string | null; code?: string | null };

// Modal compartido entre PurchaseCatalogPicker (Control de Compras) y
// CaptureFlow (Reingreso de Mercadería) — confirmado 2026-08-21: un producto
// que llegó como "esqueleto" desde la Base de datos de Just (código+nombre
// conocidos, sin fotos) no se puede usar en ninguno de los dos módulos hasta
// que alguien lo "matricula" con mínimo 3 fotos reales o de referencia del
// proveedor — para que nadie se equivoque de producto por no tener con qué
// reconocerlo. Mismo look en los dos módulos, para no tener dos estándares
// distintos de qué significa "matricular" un producto.
export function CompleteCatalogRegistration({
  item,
  onDone,
  onCancel,
}: {
  item: { id: string; name: string };
  onDone: (item: CompletedCatalogItem) => void;
  onCancel: () => void;
}) {
  const [photos, setPhotos] = useState<string[]>([]);
  const [description, setDescription] = useState("");
  const [code, setCode] = useState("");
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const { onPaste: onPastePhoto, onMouseEnter: onPasteHoverIn, onMouseLeave: onPasteHoverOut } = usePasteFile((file) => addPhoto(file));

  async function addPhoto(file: File) {
    if (photos.length >= 3) return;
    setUploadingPhoto(true);
    setErr("");
    const compressed = await compressImage(file);
    const uploaded = await uploadFile(compressed, "purchase-catalog");
    setUploadingPhoto(false);
    if (!uploaded.ok) {
      setErr(uploaded.error);
      return;
    }
    setPhotos((p) => [...p, uploaded.url]);
  }

  async function save() {
    if (photos.length < 3) {
      setErr("Se necesitan mínimo 3 fotos para matricular el producto.");
      return;
    }
    setSaving(true);
    setErr("");
    let res: Response;
    try {
      res = await fetch(`/api/purchase-catalog/${item.id}/complete-registration`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ photos, description: description.trim() || undefined, code: code.trim() || undefined }),
      });
    } catch {
      setSaving(false);
      setErr("No se pudo guardar — revisa tu conexión e intenta de nuevo.");
      return;
    }
    setSaving(false);
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      setErr(data?.error ?? "No se pudo matricular el producto.");
      return;
    }
    onDone(data);
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onCancel}>
      <div className="bg-surface border border-rule rounded-md p-4 max-w-sm w-full" onClick={(e) => e.stopPropagation()}>
        <div className="font-display font-bold text-[14.5px] mb-1">Matricular producto</div>
        <div className="text-[12.5px] text-steel mb-3">
          <b className="text-ink">{item.name}</b> viene de la base de datos de Just pero todavía no tiene fotos en DAFLOW — sube mínimo 3 para que todos puedan reconocerlo sin equivocarse.
        </div>

        <label className="block mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-steel">Fotos (mínimo 3)</label>
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
              title="Pasa el mouse y Ctrl+V para pegar una foto copiada"
              className="w-16 h-16 rounded border-[1.5px] border-dashed border-rule flex items-center justify-center cursor-pointer text-steel hover:border-teal focus:border-teal focus:outline-none"
            >
              {uploadingPhoto ? (
                <span className="w-4 h-4 rounded-full border-2 border-rule border-t-teal animate-spin" />
              ) : (
                <Camera size={18} />
              )}
              <input type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && addPhoto(e.target.files[0])} />
            </label>
          )}
        </div>
        <div className="text-[11px] text-steel mb-3">Real si lo tienes físicamente; referencial del proveedor si no — que se vea el producto exacto.</div>

        <label className="block mb-1 text-[10px] font-semibold uppercase tracking-wide text-steel">
          Descripción <span className="text-steel-dim normal-case font-normal">(opcional)</span>
        </label>
        <textarea
          rows={2}
          className="w-full rounded border border-rule px-2.5 py-2 text-[13px] mb-3"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Ej. Qué es o para qué sirve este producto"
        />

        <label className="block mb-1 text-[10px] font-semibold uppercase tracking-wide text-steel">
          Código del proveedor <span className="text-steel-dim normal-case font-normal">(opcional)</span>
        </label>
        <input
          className="w-full rounded border border-rule px-2.5 py-2 text-[13px] mb-3"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="Ej. REF-4471 — si lo tienes a la mano"
        />

        {err && <div className="text-red text-[12px] mb-2.5">{err}</div>}
        <div className="flex items-center gap-2.5">
          <button
            type="button"
            disabled={saving || uploadingPhoto || photos.length < 3}
            className="rounded border border-teal bg-teal px-3.5 py-2 text-[12.5px] font-bold text-navy cursor-pointer disabled:opacity-60"
            onClick={save}
          >
            {saving ? "Guardando…" : "Matricular"}
          </button>
          <button type="button" className="text-steel text-[12.5px] cursor-pointer" onClick={onCancel}>
            Cancelar
          </button>
        </div>
      </div>
    </div>
  );
}
