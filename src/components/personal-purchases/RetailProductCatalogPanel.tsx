"use client";

import { useEffect, useState } from "react";
import { compressImage } from "@/lib/compressImage";
import { uploadFile } from "@/lib/uploadFile";

type Product = { id: string; name: string; photo: string | null; costPrice: number; dropiPrice: number };

function EditPriceRow({ product, onSaved }: { product: Product; onSaved: () => void }) {
  const [costPrice, setCostPrice] = useState(String(product.costPrice));
  const [dropiPrice, setDropiPrice] = useState(String(product.dropiPrice));
  const [busy, setBusy] = useState(false);

  async function save() {
    const cost = Number(costPrice);
    const dropi = Number(dropiPrice);
    if (cost < 0 || dropi < 0) return;
    setBusy(true);
    await fetch(`/api/retail-products/${product.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ costPrice: cost, dropiPrice: dropi }),
    });
    setBusy(false);
    onSaved();
  }

  return (
    <div className="flex items-center gap-2 text-[12px] py-1.5 border-b border-rule last:border-0">
      <span className="flex-1 font-semibold">{product.name}</span>
      <span className="text-[10.5px] text-steel-dim">Costo</span>
      <input className="rounded border border-rule bg-cloud px-1.5 py-1 w-20" type="number" step="0.01" value={costPrice} disabled={busy}
        onChange={(e) => setCostPrice(e.target.value)} onBlur={save} />
      <span className="text-[10.5px] text-steel-dim">Dropi</span>
      <input className="rounded border border-rule bg-cloud px-1.5 py-1 w-20" type="number" step="0.01" value={dropiPrice} disabled={busy}
        onChange={(e) => setDropiPrice(e.target.value)} onBlur={save} />
    </div>
  );
}

// Confirmado 2026-08-18 (ajustado dos veces el mismo día): Nairoby (nunca
// Daniel) mantiene este catálogo, con los dos precios (costo y Dropi) — se
// pueden editar en cualquier momento porque cambian de a poco. El
// colaborador que compra solo elige de esta lista, nunca ve estos precios
// en ningún lado — el único lugar donde ve el descuento es su Rol de pago.
export function RetailProductCatalogPanel() {
  const [products, setProducts] = useState<Product[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [costPrice, setCostPrice] = useState("");
  const [dropiPrice, setDropiPrice] = useState("");
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
    const cost = Number(costPrice);
    const dropi = Number(dropiPrice);
    if (!name.trim() || cost < 0 || dropi < 0) return;
    setBusy(true);
    setErr("");
    const res = await fetch("/api/retail-products", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name.trim(), photo: photoUrl ?? undefined, costPrice: cost, dropiPrice: dropi }),
    });
    setBusy(false);
    const data = await res.json().catch(() => null);
    if (!res.ok) { setErr(data?.error ?? "No se pudo crear."); return; }
    setName(""); setCostPrice(""); setDropiPrice(""); setPhotoUrl(null); setCreating(false);
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
      <div className="text-[11px] text-steel-dim mb-3">Estos precios nunca los ve el colaborador — solo aparecen en el rol de pago cuando se descuenta.</div>

      {creating && (
        <div className="border border-rule rounded-md p-3 mb-3 bg-cloud">
          <div className="flex flex-col gap-2">
            <input className="text-[12.5px] rounded border border-rule bg-surface px-2 py-1.5" placeholder="Nombre del producto" value={name} onChange={(e) => setName(e.target.value)} />
            <div className="flex gap-2">
              <input className="text-[12.5px] rounded border border-rule bg-surface px-2 py-1.5 flex-1" type="number" step="0.01" placeholder="Precio al costo" value={costPrice} onChange={(e) => setCostPrice(e.target.value)} />
              <input className="text-[12.5px] rounded border border-rule bg-surface px-2 py-1.5 flex-1" type="number" step="0.01" placeholder="Precio Dropi" value={dropiPrice} onChange={(e) => setDropiPrice(e.target.value)} />
            </div>
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

      <div className="flex flex-col gap-1">
        {products.length === 0 && <div className="text-steel text-[12.5px]">Todavía no hay productos.</div>}
        {products.map((p) => (
          <EditPriceRow key={p.id} product={p} onSaved={load} />
        ))}
      </div>
      {products.length > 0 && <div className="text-[10.5px] text-steel-dim mt-2">Tocá afuera de un precio para guardarlo.</div>}
    </div>
  );
}
