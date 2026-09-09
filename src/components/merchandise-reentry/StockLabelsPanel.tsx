"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { Search, Printer } from "lucide-react";

type CatalogItem = { id: string; name: string; justCode: string | null; pendingRegistration: boolean };

function stockCodeFor(item: CatalogItem): string {
  return item.justCode ?? item.id;
}

// Confirmado 2026-09-09 (Fase 3, INVESTOCK): el código de cada etiqueta es
// el mismo ID que ya se usa en todos lados (justCode = ID de Dropi = ID de
// Just) — nunca uno nuevo. La etiqueta se pega UNA sola vez en la percha
// donde vive ese producto, no en cada unidad física.
export function StockLabelsPanel() {
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [qrByCode, setQrByCode] = useState<Record<string, string>>({});

  useEffect(() => {
    fetch("/api/purchase-catalog").then((r) => (r.ok ? r.json() : [])).then(setItems).catch(() => setItems([]));
  }, []);

  const filtered = query.trim()
    ? items.filter((i) => i.name.toLowerCase().includes(query.toLowerCase()) || (i.justCode ?? "").toLowerCase().includes(query.toLowerCase()))
    : items;

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const selectedItems = items.filter((i) => selected.has(i.id));

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const missing = selectedItems.filter((i) => !qrByCode[stockCodeFor(i)]);
      if (missing.length === 0) return;
      const entries = await Promise.all(missing.map(async (i) => [stockCodeFor(i), await QRCode.toDataURL(stockCodeFor(i), { margin: 1, width: 200 })] as const));
      if (!cancelled) setQrByCode((prev) => ({ ...prev, ...Object.fromEntries(entries) }));
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);

  return (
    <div className="mt-6">
      <h3 className="print:hidden text-[13.5px] font-bold text-ink mb-2">Etiquetas de percha</h3>
      <p className="print:hidden text-[12px] text-steel mb-3">
        Elige los productos y genera una hoja para imprimir — una etiqueta por producto, para pegar en la percha donde vive (no en cada unidad).
      </p>

      <div className="flex items-center gap-2 mb-3 print:hidden">
        <div className="flex items-center gap-1.5 flex-1 rounded border border-rule px-2.5 py-1.5">
          <Search size={13} className="text-steel" />
          <input className="flex-1 text-[13px] outline-none" placeholder="Buscar producto o código…" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <button
          type="button"
          disabled={selected.size === 0}
          className="flex items-center gap-1.5 rounded border border-blue bg-blue px-3.5 py-1.5 text-[12.5px] font-semibold text-white cursor-pointer disabled:opacity-60"
          onClick={() => window.print()}
        >
          <Printer size={13} /> Imprimir ({selected.size})
        </button>
      </div>

      <label className="flex items-center gap-2 text-[12.5px] px-2 py-1 mb-1 rounded hover:bg-cloud cursor-pointer print:hidden">
        <input
          type="checkbox"
          checked={filtered.length > 0 && filtered.every((i) => selected.has(i.id))}
          onChange={(e) => {
            setSelected((prev) => {
              const next = new Set(prev);
              if (e.target.checked) filtered.forEach((i) => next.add(i.id));
              else filtered.forEach((i) => next.delete(i.id));
              return next;
            });
          }}
        />
        <span className="font-semibold text-steel">Marcar todo{query.trim() ? " (resultados)" : ""}</span>
      </label>

      <div className="max-h-64 overflow-y-auto flex flex-col gap-1 print:hidden">
        {filtered.map((i) => (
          <label key={i.id} className="flex items-center gap-2 text-[12.5px] px-2 py-1 rounded hover:bg-cloud cursor-pointer">
            <input type="checkbox" checked={selected.has(i.id)} onChange={() => toggle(i.id)} />
            <span className="flex-1">{i.name}</span>
            <span className="text-steel font-mono text-[11px]">{stockCodeFor(i)}</span>
          </label>
        ))}
      </div>

      {selectedItems.length > 0 && (
        <div className="mt-4 grid grid-cols-2 sm:grid-cols-3 gap-4 print:grid-cols-2">
          {selectedItems.map((i) => {
            const code = stockCodeFor(i);
            const qr = qrByCode[code];
            return (
              <div key={i.id} className="border border-rule rounded-md p-3 text-center print:break-inside-avoid">
                <div className="text-[12px] font-semibold text-ink mb-2 line-clamp-2">{i.name}</div>
                {qr && <img src={qr} alt={code} className="mx-auto w-28 h-28" />}
                <div className="text-[11px] font-mono text-steel mt-1">{code}</div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
