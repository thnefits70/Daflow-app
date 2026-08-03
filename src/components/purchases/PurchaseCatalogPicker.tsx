"use client";

import { useEffect, useState } from "react";
import { Search, Plus, Camera, AlertTriangle, CheckCircle2, Trash2 } from "lucide-react";
import { uploadFile } from "@/lib/uploadFile";
import { compressImage } from "@/lib/compressImage";
import { usePasteFile } from "@/lib/usePasteFile";

export type CatalogItemDTO = { id: string; name: string; photos: string[]; description?: string | null; code?: string | null };

// Confirmado 2026-07-30 (boceto aprobado): un nombre por insumo, siempre. El
// match EXACTO bloquea directo (obliga a seleccionar el existente); el
// parecido-pero-no-idéntico solo avisa vía IA — la persona decide.
export function PurchaseCatalogPicker({
  value,
  onChange,
  isAdmin = false,
}: {
  value: CatalogItemDTO | null;
  onChange: (item: CatalogItemDTO | null) => void;
  isAdmin?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CatalogItemDTO[]>([]);
  const [open, setOpen] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteErr, setDeleteErr] = useState<string | null>(null);

  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [newCode, setNewCode] = useState("");
  const [photos, setPhotos] = useState<string[]>([]);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const onPastePhoto = usePasteFile((file) => addPhoto(file));
  const [similarity, setSimilarity] = useState<{ suspected: boolean; matchedName: string | null; message: string | null } | null>(null);
  const [checkingSimilarity, setCheckingSimilarity] = useState(false);
  const [confirmStep, setConfirmStep] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (value) return;
    let active = true;
    fetch("/api/purchase-catalog")
      .then((r) => (r.ok ? r.json() : []))
      .then((data: CatalogItemDTO[]) => {
        if (active) setResults(data);
      })
      .catch(() => null);
    return () => {
      active = false;
    };
  }, [value]);

  const filtered = query.trim()
    ? results.filter((r) => r.name.toLowerCase().includes(query.trim().toLowerCase()))
    : results;

  async function startCreate() {
    setCreating(true);
    setNewName(query);
    setNewDescription("");
    setNewCode("");
    setPhotos([]);
    setSimilarity(null);
    setConfirmStep(false);
    setErr("");
  }

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

  async function goToConfirm() {
    if (!newName.trim()) {
      setErr("Escribe el nombre del producto, mercadería o insumo.");
      return;
    }
    if (photos.length === 0) {
      setErr("Agrega al menos 1 foto del producto.");
      return;
    }
    setErr("");
    setCheckingSimilarity(true);
    const res = await fetch("/api/purchase-catalog/check-name", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newName.trim() }),
    });
    setCheckingSimilarity(false);
    const data = await res.json().catch(() => null);
    if (data?.exactMatch) {
      setErr(`Ya existe "${data.exactMatch.name}" — selecciónalo de la lista en vez de crear uno nuevo.`);
      setCreating(false);
      onChange({ id: data.exactMatch.id, name: data.exactMatch.name, photos: [] });
      return;
    }
    setSimilarity(data?.similarity ?? null);
    setConfirmStep(true);
  }

  async function saveNew() {
    setBusy(true);
    setErr("");
    const res = await fetch("/api/purchase-catalog", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newName.trim(), photos, description: newDescription.trim() || undefined, code: newCode.trim() || undefined }),
    });
    setBusy(false);
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      setErr(data?.error ?? "No se pudo crear el producto, mercadería o insumo.");
      return;
    }
    setCreating(false);
    onChange(data);
  }

  // Confirmado 2026-08-03: eliminar es SOLO del administrador (nadie más ve
  // este ícono), y con confirmación siempre — para no borrar algo por
  // accidente. El servidor igual vuelve a bloquear si el insumo ya tiene
  // compras registradas.
  async function deleteItem(item: CatalogItemDTO, e: React.MouseEvent) {
    e.stopPropagation();
    if (!confirm(`¿Eliminar "${item.name}" del catálogo? Esta acción no se puede deshacer.`)) return;
    setDeletingId(item.id);
    setDeleteErr(null);
    const res = await fetch(`/api/purchase-catalog/${item.id}`, { method: "DELETE" });
    setDeletingId(null);
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setDeleteErr(data?.error ?? "No se pudo eliminar.");
      return;
    }
    setResults((rs) => rs.filter((r) => r.id !== item.id));
  }

  if (value) {
    return (
      <div className="flex items-center gap-2.5 bg-cloud border border-rule rounded-md px-3 py-2.5">
        {value.photos[0] && <img src={value.photos[0]} alt="" className="w-9 h-9 rounded object-cover shrink-0" />}
        <div className="flex-1 min-w-0">
          <div className="text-[13.5px] font-semibold">{value.name}</div>
          {value.description && <div className="text-[11px] text-steel truncate">{value.description}</div>}
        </div>
        <button type="button" className="text-[11.5px] text-blue font-semibold cursor-pointer" onClick={() => onChange(null)}>
          Cambiar
        </button>
      </div>
    );
  }

  if (creating) {
    return (
      <div className="bg-surface2 border border-rule rounded-md p-3.5">
        {!confirmStep ? (
          <>
            <label className="block mb-1 text-[10px] font-semibold uppercase tracking-wide text-steel">Nombre del producto, mercadería o insumo nuevo</label>
            <input
              className="w-full rounded border border-rule px-2.5 py-2 text-[13.5px] mb-3"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Ej. Rollos de cinta roja"
            />
            <label className="block mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-steel">Fotos (1 a 3)</label>
            <div className="flex gap-2 mb-3">
              {photos.map((p, i) => (
                <img key={i} src={p} alt="" className="w-16 h-16 rounded object-cover border border-rule" />
              ))}
              {photos.length < 3 && (
                <label
                  tabIndex={0}
                  onPaste={onPastePhoto}
                  title="Clic aquí y Ctrl+V para pegar una foto copiada"
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
            <div className="text-[11px] text-steel mb-3">
              Real si lo tienes físicamente; referencial del proveedor (misma foto de la cotización) si no — que se vea el producto exacto.
            </div>
            <label className="block mb-1 text-[10px] font-semibold uppercase tracking-wide text-steel">
              Descripción <span className="text-steel-dim normal-case font-normal">(opcional)</span>
            </label>
            <textarea
              rows={2}
              className="w-full rounded border border-rule px-2.5 py-2 text-[13px] mb-3"
              value={newDescription}
              onChange={(e) => setNewDescription(e.target.value)}
              placeholder="Ej. Qué es o para qué sirve este producto — ayuda a identificarlo"
            />
            <label className="block mb-1 text-[10px] font-semibold uppercase tracking-wide text-steel">
              Código del proveedor <span className="text-steel-dim normal-case font-normal">(opcional — si lo tienes a la mano)</span>
            </label>
            <input
              className="w-full rounded border border-rule px-2.5 py-2 text-[13px] mb-3"
              value={newCode}
              onChange={(e) => setNewCode(e.target.value)}
              placeholder="Ej. REF-4471 — si la cotización trae un código en vez de nombre"
            />
            {err && <div className="text-red text-[12px] mb-2.5">{err}</div>}
            <div className="flex items-center gap-2.5">
              <button
                type="button"
                disabled={checkingSimilarity}
                className="rounded border border-blue bg-blue px-3.5 py-2 text-[12.5px] font-semibold text-white cursor-pointer disabled:opacity-60"
                onClick={goToConfirm}
              >
                {checkingSimilarity ? "Revisando…" : "Continuar"}
              </button>
              <button type="button" className="text-steel text-[12.5px] cursor-pointer" onClick={() => setCreating(false)}>
                Cancelar
              </button>
            </div>
          </>
        ) : (
          <>
            {similarity?.suspected && (
              <div className="flex items-start gap-2 bg-gold/10 border border-gold/30 rounded-md p-3 mb-3 text-[12.5px]" style={{ color: "#D9A441" }}>
                <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                <span className="text-ink">{similarity.message}</span>
              </div>
            )}
            <div className="bg-cloud border border-rule rounded-md p-3 mb-3">
              <div className="text-[13px] font-semibold mb-1">{newName}</div>
              {newDescription.trim() && <div className="text-[12px] text-steel mb-2">{newDescription.trim()}</div>}
              <div className="flex gap-1.5">
                {photos.map((p, i) => (
                  <img key={i} src={p} alt="" className="w-12 h-12 rounded object-cover" />
                ))}
              </div>
            </div>
            <div className="text-[11.5px] text-ink mb-3">
              <b>¿Verificaste que todos los detalles están escritos correctamente?</b> — no se puede corregir un error de tipeo sin pedirle autorización al administrador.
            </div>
            {err && <div className="text-red text-[12px] mb-2.5">{err}</div>}
            <div className="flex items-center gap-2.5">
              <button
                type="button"
                disabled={busy}
                className="rounded border border-teal bg-teal px-3.5 py-2 text-[12.5px] font-bold text-navy cursor-pointer disabled:opacity-60"
                onClick={saveNew}
              >
                Guardar
              </button>
              <button type="button" className="text-steel text-[12.5px] cursor-pointer" onClick={() => setConfirmStep(false)}>
                Atrás
              </button>
            </div>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="relative">
      <div className="relative">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-steel" />
        <input
          className="w-full rounded border border-rule pl-8.5 pr-3 py-2 text-[13.5px]"
          placeholder="Buscar o crear producto, mercadería o insumo"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => setOpen(true)}
        />
      </div>
      {open && (
        <div className="mt-1.5 bg-surface2 border border-rule rounded-md overflow-hidden max-h-56 overflow-y-auto">
          {deleteErr && <div className="px-3 py-2 text-[11.5px] text-red border-b border-rule">{deleteErr}</div>}
          {filtered.map((item) => (
            <div key={item.id} className="flex items-center border-b border-rule last:border-none">
              <button
                type="button"
                className="flex-1 min-w-0 flex items-center gap-2.5 px-3 py-2 text-left text-[13px] hover:bg-cloud cursor-pointer"
                onClick={() => {
                  onChange(item);
                  setOpen(false);
                }}
              >
                <CheckCircle2 size={13} className="text-teal shrink-0" />
                <span className="truncate">{item.name}</span>
              </button>
              {isAdmin && (
                <button
                  type="button"
                  title="Eliminar (solo administrador)"
                  disabled={deletingId === item.id}
                  className="px-2.5 py-2 text-steel hover:text-red cursor-pointer disabled:opacity-50 shrink-0"
                  onClick={(e) => deleteItem(item, e)}
                >
                  {deletingId === item.id ? <span className="block w-3.5 h-3.5 rounded-full border-2 border-rule border-t-red animate-spin" /> : <Trash2 size={14} />}
                </button>
              )}
            </div>
          ))}
          <button
            type="button"
            className="w-full flex items-center gap-2 px-3 py-2 text-left text-[12.5px] text-blue font-semibold hover:bg-cloud cursor-pointer"
            onClick={startCreate}
          >
            <Plus size={13} /> Crear {query.trim() ? `"${query.trim()}"` : "producto, mercadería o insumo nuevo"} — solo si de verdad es distinto
          </button>
        </div>
      )}
    </div>
  );
}
