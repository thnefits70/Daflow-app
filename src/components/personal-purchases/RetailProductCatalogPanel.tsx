"use client";

import { useEffect, useState } from "react";
import { compressImage } from "@/lib/compressImage";
import { uploadFile } from "@/lib/uploadFile";

type Product = { id: string; name: string; photo: string | null };

// Confirmado 2026-08-18 (ajustado el mismo día): Daniel (Inventario) o admin
// mantienen este catálogo — el colaborador que compra solo elige de esta
// lista, nunca crea productos al vuelo. El catálogo no guarda precio —
// Nairoby lo digita en dólares recién al cerrar cada compra.
export function RetailProductCatalogPanel() {
  const [products, setProducts] = useState<Product[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  function load() {
    fetch("/api/retail-products").then((r) => (r.ok ? r.json() : [])).then(setProducts);
  }
  useEffect(load, []);

  async function onPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    const compressed = await compressImage(file);
    const result = await uploadFile(compressed, "retail-product-photos");
    setUploading(false);
    if (result.ok) setPhotoUrl(result.url);
  }

  async function submit() {
    if (!name.trim()) return;
    setBusy(true);
    setErr("");
    const res = await fetch("/api/retail-products", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name.trim(), photo: photoUrl ?? undefined }),
    });
    setBusy(false);
    const data = await res.json().catch(() => null);
    if (!res.ok) { setErr(data?.error ?? "No se pudo crear."); return; }
    setName(""); setPhotoUrl(null); setCreating(false);
    load();
  }

  if (!products) return <div className="text-steel text-[13px]">Cargando…</div>;

  return (
    <div className="bg-surface border border-rule rounded-md p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-steel">Catálogo de productos ({products.length})</div>
        {!creating && (
          <button type="button" className="text-[11.5px] font-semibold text-blue cursor-pointer" onClick={() => setCreating(true)}>+ Agregar producto</button>
        )}
      </div>

      {creating && (
        <div className="border border-rule rounded-md p-3 mb-3 bg-cloud">
          <div className="flex flex-col gap-2">
            <input className="text-[12.5px] rounded border border-rule bg-surface px-2 py-1.5" placeholder="Nombre del producto" value={name} onChange={(e) => setName(e.target.value)} />
            <label className="text-[11.5px] font-semibold text-blue cursor-pointer">
              {uploading ? "Subiendo…" : photoUrl ? "Foto lista — cambiar" : "Agregar foto (opcional)"}
              <input type="file" accept="image/*" className="hidden" onChange={onPhoto} />
            </label>
            {err && <div className="text-red text-[12px]">{err}</div>}
            <div className="flex gap-2">
              <button type="button" disabled={busy} className="text-[12px] font-bold bg-blue text-white rounded px-3 py-1.5 cursor-pointer disabled:opacity-50" onClick={submit}>Guardar</button>
              <button type="button" className="text-[12px] text-steel cursor-pointer" onClick={() => setCreating(false)}>Cancelar</button>
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        {products.map((p) => (
          <div key={p.id} className="flex items-center gap-2 text-[12.5px] py-1.5 border-b border-rule last:border-0">
            <span className="flex-1 font-semibold">{p.name}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
