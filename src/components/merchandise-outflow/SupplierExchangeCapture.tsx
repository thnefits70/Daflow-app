"use client";

import { useEffect, useState } from "react";
import { Check, Search } from "lucide-react";
import { ProductMatchPicker, type MatchCatalogItem, type ProductMatchResult } from "@/components/merchandise-reentry/ProductMatchPicker";

type SupplierOption = { id: string; name: string };

async function postJson(url: string, body?: unknown) {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error ?? "Ocurrió un error.");
  return data;
}

// Daniel manda mercadería YA registrada en Just de vuelta a un proveedor
// para cambio — un solo paso, sale de Just en el momento en que se manda.
export function SupplierExchangeCapture({ onSent }: { onSent?: () => void }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SupplierOption[]>([]);
  const [supplier, setSupplier] = useState<SupplierOption | null>(null);
  const [selected, setSelected] = useState<MatchCatalogItem | null>(null);
  const [manualName, setManualName] = useState("");
  const [quantity, setQuantity] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);

  useEffect(() => {
    if (supplier) return;
    const t = setTimeout(() => {
      fetch(`/api/merchandise-outflow/supplier-search?q=${encodeURIComponent(query.trim())}`)
        .then((r) => (r.ok ? r.json() : []))
        .then(setResults)
        .catch(() => null);
    }, 200);
    return () => clearTimeout(t);
  }, [query, supplier]);

  function reset() {
    setQuery("");
    setSupplier(null);
    setSelected(null);
    setManualName("");
    setQuantity("");
    setConfirming(false);
    setSent(false);
  }

  const qty = Number(quantity) || 0;
  const hasName = !!selected || manualName.trim().length > 0;
  const canSave = !!supplier && hasName && qty > 0 && !saving;
  const finalName = selected ? selected.name : manualName.trim();

  async function save() {
    if (!supplier) return;
    setSaving(true);
    setError("");
    try {
      await postJson("/api/merchandise-outflow/supplier-exchange", {
        supplierId: supplier.id,
        catalogItemId: selected?.id,
        declaredName: selected ? undefined : manualName.trim(),
        quantity: qty,
      });
      setSent(true);
      onSent?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo registrar el cambio.");
    } finally {
      setSaving(false);
    }
  }

  if (sent) {
    return (
      <div className="bg-surface border border-rule rounded-md p-6 max-w-sm text-center">
        <div className="w-11 h-11 rounded-full bg-green/15 border border-green/40 flex items-center justify-center mx-auto mb-3">
          <Check size={20} className="text-green" />
        </div>
        <div className="font-display font-bold text-[15px] mb-1.5">Registrado</div>
        <p className="text-[12.5px] text-steel mb-4">Ya cayó en la cola de dar de baja en Just, y queda pendiente de saber si el proveedor cambia el producto o da crédito.</p>
        <button type="button" className="text-[12.5px] font-bold text-teal cursor-pointer" onClick={reset}>Registrar otro</button>
      </div>
    );
  }

  if (confirming) {
    return (
      <div className="bg-surface border border-rule rounded-md p-4 max-w-sm">
        <div className="font-display font-bold text-[14px] mb-2.5">Revisa antes de registrar</div>
        <div className="flex flex-col gap-2 text-[12.5px] mb-3">
          <div className="flex items-start justify-between gap-3"><span className="text-steel shrink-0">Proveedor</span><span className="font-semibold text-right">{supplier?.name}</span></div>
          <div className="flex items-start justify-between gap-3"><span className="text-steel shrink-0">Producto</span><span className="font-semibold text-right">{finalName}</span></div>
          <div className="flex items-start justify-between gap-3"><span className="text-steel shrink-0">Cantidad</span><span className="font-semibold">{qty}</span></div>
        </div>
        <p className="text-[11.5px] text-steel mb-3">Esto se registra como que la mercadería YA salió de Just — confirmá que de verdad la vas a enviar.</p>
        {error && <div className="text-red text-[11.5px] mb-2">{error}</div>}
        <div className="flex gap-2">
          <button type="button" className="flex-1 rounded border border-rule px-3 py-2 text-[12px] font-semibold cursor-pointer" onClick={() => setConfirming(false)}>Revisar de nuevo</button>
          <button type="button" disabled={saving} className="flex-1 rounded border border-teal bg-teal px-3 py-2 text-[12px] font-bold text-navy cursor-pointer disabled:opacity-60" onClick={save}>
            {saving ? "Registrando…" : "Sí, ya lo mando"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-surface border border-rule rounded-md p-3.5 flex flex-col gap-3.5 max-w-sm">
      <div>
        <label className="block mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-steel">1 · Proveedor</label>
        {supplier ? (
          <div className="flex items-center gap-2.5 bg-green/10 border border-green/35 rounded-md p-2.5">
            <div className="flex-1 min-w-0 text-[12.5px] font-semibold truncate">{supplier.name}</div>
            <button type="button" className="shrink-0 text-[11px] font-semibold text-blue cursor-pointer" onClick={() => setSupplier(null)}>Cambiar</button>
          </div>
        ) : (
          <div className="bg-cloud rounded-md p-3">
            <div className="flex items-center gap-1.5 rounded border border-rule bg-surface px-2.5 py-2">
              <Search size={13} className="text-steel" />
              <input type="text" autoFocus placeholder="Buscá el proveedor…" className="flex-1 text-[12.5px] outline-none bg-transparent" value={query} onChange={(e) => setQuery(e.target.value)} />
            </div>
            {results.length > 0 && (
              <div className="flex flex-col gap-1 mt-1.5 border border-rule rounded-md overflow-hidden">
                {results.map((s) => (
                  <button key={s.id} type="button" className="text-left p-2 text-[12.5px] font-medium hover:bg-surface cursor-pointer" onClick={() => setSupplier(s)}>
                    {s.name}
                  </button>
                ))}
              </div>
            )}
            {query.trim().length > 0 && results.length === 0 && <div className="text-[11.5px] text-steel mt-1">No se encontró ningún proveedor con ese nombre.</div>}
          </div>
        )}
      </div>

      {supplier && (
        <div>
          <label className="block mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-steel">2 · Producto</label>
          {selected ? (
            <div className="flex items-center gap-2.5 bg-green/10 border border-green/35 rounded-md p-2.5">
              <div className="flex-1 min-w-0 text-[12.5px] font-semibold truncate">{selected.name}</div>
              <button type="button" className="shrink-0 text-[11px] font-semibold text-blue cursor-pointer" onClick={() => setSelected(null)}>Cambiar</button>
            </div>
          ) : manualName ? (
            <div className="flex items-center gap-2.5 bg-cloud rounded-md p-2.5">
              <div className="flex-1 min-w-0 text-[12.5px] font-medium truncate">{manualName}</div>
              <button type="button" className="shrink-0 text-[11px] font-semibold text-blue cursor-pointer" onClick={() => setManualName("")}>Cambiar</button>
            </div>
          ) : (
            <ProductMatchPicker referencePhotoUrl={null} onConfirm={(r: ProductMatchResult) => ("catalogItem" in r ? setSelected(r.catalogItem) : setManualName(r.manualName))} />
          )}
        </div>
      )}

      {supplier && (
        <div>
          <label className="block mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-steel">3 · Cantidad</label>
          <input type="number" min={1} className="w-24 rounded border border-rule bg-cloud px-2.5 py-1.5 text-[13px] font-bold" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
        </div>
      )}

      {error && <div className="text-red text-[11.5px]">{error}</div>}

      <button type="button" disabled={!canSave} className="rounded border border-teal bg-teal px-3 py-2 text-[12.5px] font-bold text-navy cursor-pointer disabled:opacity-40" onClick={() => setConfirming(true)}>
        Registrar cambio con proveedor
      </button>
    </div>
  );
}
