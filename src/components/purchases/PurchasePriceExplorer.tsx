"use client";

import { useEffect, useMemo, useState } from "react";
import { Search, X, ChevronDown, Award } from "lucide-react";
import { PriceTrendChart } from "./PriceTrendChart";
import type { SupplierPriceHistory } from "@/app/api/purchase-catalog/[id]/supplier-comparison/route";

type CatalogItem = { id: string; name: string; photos: string[]; description?: string | null; code?: string | null };

function normalize(s: string) {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

function levenshtein(a: string, b: string) {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

// Puntaje de similitud — coincidencia exacta/por prefijo/por palabra pesa
// más que el parecido difuso, que solo entra como respaldo para tolerar
// errores de tipeo (ej. "audifonos" vs "audífono").
function scoreMatch(item: CatalogItem, query: string): number {
  const q = normalize(query);
  if (!q) return 0;
  const n = normalize(item.name);
  if (n === q) return 100;
  if (n.startsWith(q)) return 90;
  if (n.includes(q)) return 75;
  if (n.split(/\s+/).some((w) => w.startsWith(q))) return 65;
  if (item.code && normalize(item.code).includes(q)) return 55;
  const dist = levenshtein(n, q);
  const ratio = 1 - dist / Math.max(n.length, q.length);
  return ratio >= 0.6 ? Math.round(ratio * 50) : -1;
}

function ProductComparisonCard({ item, onRemove }: { item: CatalogItem; onRemove: () => void }) {
  const [suppliers, setSuppliers] = useState<SupplierPriceHistory[] | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/purchase-catalog/${item.id}/supplier-comparison`)
      .then((r) => (r.ok ? r.json() : []))
      .then(setSuppliers)
      .catch(() => setSuppliers([]));
  }, [item.id]);

  const cheapestId = suppliers && suppliers.length > 0 ? suppliers[0].supplierId : null;

  return (
    <div className="bg-surface border border-rule rounded-md p-4">
      <div className="flex items-center gap-3 mb-3.5">
        {item.photos[0] && <img src={item.photos[0]} alt="" className="w-10 h-10 rounded object-cover border border-rule shrink-0" />}
        <div className="flex-1 min-w-0">
          <div className="text-[14.5px] font-bold truncate">{item.name}</div>
          {item.description && <div className="text-[11.5px] text-steel truncate">{item.description}</div>}
        </div>
        <button type="button" className="text-steel hover:text-red cursor-pointer p-1" onClick={onRemove} title="Quitar">
          <X size={15} />
        </button>
      </div>

      {suppliers === null ? (
        <div className="text-steel text-[12.5px]">Cargando historial…</div>
      ) : suppliers.length === 0 ? (
        <div className="border-[1.5px] border-dashed border-rule rounded-md p-5 text-center text-steel text-[12.5px]">
          Todavía no hay compras registradas de este insumo.
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {suppliers.map((s) => {
            const isCheapest = s.supplierId === cheapestId;
            const isOpen = expandedId === s.supplierId;
            return (
              <div key={s.supplierId} className={`rounded-md border ${isCheapest ? "border-teal/50 bg-teal/[0.06]" : "border-rule bg-surface2"}`}>
                <button
                  type="button"
                  className="w-full flex items-center gap-3 px-3 py-2.5 text-left cursor-pointer"
                  onClick={() => setExpandedId(isOpen ? null : s.supplierId)}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-[13px] font-semibold truncate">{s.supplierName}</span>
                      {isCheapest && (
                        <span className="flex items-center gap-1 text-[9.5px] font-bold uppercase tracking-wide bg-teal/15 text-teal border border-teal/40 rounded-full px-2 py-0.5">
                          <Award size={9} /> Más barato
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-steel mt-0.5">
                      {s.count} {s.count === 1 ? "compra" : "compras"} · promedio ${s.avg.toFixed(2)}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className={`text-[16px] font-bold ${isCheapest ? "text-teal" : "text-ink"}`}>${s.latest.toFixed(2)}</div>
                    <div className="text-[10px] text-steel">última compra</div>
                  </div>
                  <ChevronDown size={15} className={`text-steel shrink-0 transition-transform ${isOpen ? "rotate-180" : ""}`} />
                </button>
                {isOpen && (
                  <div className="px-3 pb-3.5 pt-1 border-t border-rule">
                    <PriceTrendChart points={s.history} />
                    <div className="grid grid-cols-3 gap-2 mt-2">
                      <div className="bg-cloud rounded p-2 text-center">
                        <div className="text-[8.5px] uppercase text-steel">Más bajo</div>
                        <div className="text-[12.5px] font-bold text-green">${s.min.toFixed(2)}</div>
                      </div>
                      <div className="bg-cloud rounded p-2 text-center">
                        <div className="text-[8.5px] uppercase text-steel">Promedio</div>
                        <div className="text-[12.5px] font-bold text-teal">${s.avg.toFixed(2)}</div>
                      </div>
                      <div className="bg-cloud rounded p-2 text-center">
                        <div className="text-[8.5px] uppercase text-steel">Más alto</div>
                        <div className="text-[12.5px] font-bold text-red">${s.max.toFixed(2)}</div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Confirmado 2026-07-31: buscador con similitud (tolera errores de tipeo y
// coincidencias parciales) para encontrar rápido a quién comprarle un
// producto más barato — cada resultado seleccionado se acumula como una
// tarjeta aparte, comparando todos los proveedores a los que se les ha
// comprado ese insumo, ordenados del más barato al más caro.
export function PurchasePriceExplorer() {
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<CatalogItem[]>([]);

  useEffect(() => {
    fetch("/api/purchase-catalog")
      .then((r) => (r.ok ? r.json() : []))
      .then(setCatalog)
      .catch(() => setCatalog([]));
  }, []);

  const results = useMemo(() => {
    if (!query.trim()) return [];
    return catalog
      .map((item) => ({ item, score: scoreMatch(item, query) }))
      .filter((r) => r.score >= 0 && !selected.some((s) => s.id === r.item.id))
      .sort((a, b) => b.score - a.score)
      .slice(0, 8)
      .map((r) => r.item);
  }, [catalog, query, selected]);

  function select(item: CatalogItem) {
    setSelected((s) => [item, ...s.filter((x) => x.id !== item.id)]);
    setQuery("");
  }

  return (
    <div>
      <div className="relative mb-4">
        <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-steel" />
        <input
          className="w-full rounded border border-rule px-3 py-2.5 pl-10 text-[14px] bg-surface2"
          placeholder="Busca un producto para comparar precios entre proveedores… ej. audífonos"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {results.length > 0 && (
          <div className="absolute z-10 mt-1.5 w-full bg-surface2 border border-rule rounded-md overflow-hidden max-h-64 overflow-y-auto shadow-lg">
            {results.map((item) => (
              <button
                key={item.id}
                type="button"
                className="w-full flex items-center gap-2.5 px-3 py-2 text-left text-[13px] hover:bg-cloud cursor-pointer border-b border-rule last:border-none"
                onClick={() => select(item)}
              >
                {item.photos[0] && <img src={item.photos[0]} alt="" className="w-7 h-7 rounded object-cover shrink-0" />}
                <span className="truncate">{item.name}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {selected.length === 0 ? (
        <div className="border-[1.5px] border-dashed border-rule rounded-md p-8 text-center text-steel text-[13.5px]">
          Busca un producto arriba para ver qué proveedores te lo han vendido y a qué precio.
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {selected.map((item) => (
            <ProductComparisonCard key={item.id} item={item} onRemove={() => setSelected((s) => s.filter((x) => x.id !== item.id))} />
          ))}
        </div>
      )}
    </div>
  );
}
