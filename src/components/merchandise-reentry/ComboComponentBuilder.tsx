"use client";

import { useEffect, useState } from "react";
import { Clock, X } from "lucide-react";
import type { MatchCatalogItem } from "./ProductMatchPicker";

export type ComboDraftComponent = { catalogItem: MatchCatalogItem; quantity: number };

// Confirmado 2026-08-26 (pedido explícito del usuario): al buscar qué
// productos reales componen un combo de Dropi, las sugerencias muestran
// FOTO primero — es lo que de verdad le permite a Daniel confirmar que es
// el producto correcto, el nombre solo no alcanza cuando hay productos
// parecidos. Compartido entre DropiComboManager (gestión) y
// DocumentCaptureFlow (desglosar un combo nuevo en el momento de leer un
// documento).
export function ComboComponentBuilder({ components, onChange }: { components: ComboDraftComponent[]; onChange: (next: ComboDraftComponent[]) => void }) {
  const [catalog, setCatalog] = useState<MatchCatalogItem[] | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    fetch("/api/merchandise-reentry/catalog-search")
      .then((r) => (r.ok ? r.json() : []))
      .then(setCatalog)
      .catch(() => setCatalog([]));
  }, []);

  function addComponent(item: MatchCatalogItem) {
    if (components.some((c) => c.catalogItem.id === item.id)) return;
    onChange([...components, { catalogItem: item, quantity: 1 }]);
    setQuery("");
  }

  function removeComponent(itemId: string) {
    onChange(components.filter((c) => c.catalogItem.id !== itemId));
  }

  function updateQty(itemId: string, qty: number) {
    onChange(components.map((c) => (c.catalogItem.id === itemId ? { ...c, quantity: qty } : c)));
  }

  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const suggestions =
    words.length === 0
      ? []
      : (catalog ?? [])
          .filter((c) => !components.some((comp) => comp.catalogItem.id === c.id))
          .filter((c) => words.every((w) => c.name.toLowerCase().includes(w) || (!!c.justCode && c.justCode.toLowerCase().includes(w))))
          .slice(0, 6);

  return (
    <div>
      {components.length > 0 && (
        <div className="flex flex-col gap-1.5 mb-2">
          {components.map((c) => (
            <div key={c.catalogItem.id} className="flex items-center gap-2.5 bg-surface border border-rule rounded-md p-2">
              {c.catalogItem.photos[0] ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={c.catalogItem.photos[0]} alt={c.catalogItem.name} className="w-10 h-10 object-cover rounded border border-rule shrink-0" />
              ) : (
                <div className="w-10 h-10 rounded border border-dashed border-rule shrink-0 flex items-center justify-center text-steel">
                  <Clock size={14} />
                </div>
              )}
              <span className="flex-1 min-w-0 text-[12px] font-medium truncate">{c.catalogItem.name}</span>
              <input
                type="number"
                min={1}
                className="w-16 rounded border border-rule bg-cloud px-2 py-1 text-[12px] font-bold"
                value={c.quantity}
                onChange={(e) => updateQty(c.catalogItem.id, Number(e.target.value) || 0)}
              />
              <span className="text-[11px] text-steel shrink-0">un.</span>
              <button type="button" className="text-steel hover:text-red cursor-pointer shrink-0" onClick={() => removeComponent(c.catalogItem.id)}>
                <X size={13} />
              </button>
            </div>
          ))}
        </div>
      )}

      <input
        type="text"
        placeholder="Buscar producto real por nombre o código…"
        className="w-full rounded border border-rule bg-surface px-2.5 py-2 text-[12.5px]"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {suggestions.length > 0 && (
        <div className="flex flex-col gap-1 mt-1.5 border border-rule rounded-md overflow-hidden">
          {suggestions.map((c) => (
            <button key={c.id} type="button" className="flex items-center gap-2.5 p-2 text-left hover:bg-surface cursor-pointer" onClick={() => addComponent(c)}>
              {c.photos[0] ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={c.photos[0]} alt={c.name} className="w-10 h-10 object-cover rounded border border-rule shrink-0" />
              ) : (
                <div className="w-10 h-10 rounded border border-dashed border-rule shrink-0 flex items-center justify-center text-steel">
                  <Clock size={14} />
                </div>
              )}
              <span className="flex-1 min-w-0 text-[12px] font-medium truncate">{c.name}</span>
              {c.justCode && <span className="font-mono text-[10.5px] text-steel shrink-0">#{c.justCode}</span>}
            </button>
          ))}
        </div>
      )}
      {words.length > 0 && suggestions.length === 0 && catalog !== null && <div className="text-[11.5px] text-steel mt-1">No se encontró nada con esas palabras.</div>}
    </div>
  );
}
