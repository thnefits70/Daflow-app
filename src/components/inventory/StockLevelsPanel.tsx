"use client";

import { useEffect, useState } from "react";
import { Search, ArrowUpDown } from "lucide-react";
import { CatalogCode } from "@/components/shared/CatalogCode";
import { TabGuide } from "@/components/shared/TabGuide";

type StockRow = { catalogItemId: string; name: string; justCode: string | null; balance: number; avgCost: number };
type SortKey = "name" | "balance";

function money(v: number) {
  return "$" + v.toLocaleString("es-EC", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Confirmado 2026-09-10 (pedido explícito del usuario): pantalla propia
// dentro de Inventario para que Daniel y el admin vean, en cualquier
// momento, el stock de INVESTOCK de todos los productos — no solo los
// negativos (ya cubiertos en KPIs financieros) ni solo lo de la última
// semana subida (Control de Inventario).
export function StockLevelsPanel() {
  const [rows, setRows] = useState<StockRow[] | null>(null);
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("name");

  useEffect(() => {
    fetch("/api/inventory-control/stock-levels")
      .then((r) => (r.ok ? r.json() : []))
      .then(setRows)
      .catch(() => setRows([]));
  }, []);

  if (rows === null) return <div className="text-steel text-[13px]">Cargando…</div>;

  const filtered = query.trim()
    ? rows.filter((r) => r.name.toLowerCase().includes(query.toLowerCase()) || (r.justCode ?? "").toLowerCase().includes(query.toLowerCase()))
    : rows;

  const sorted = [...filtered].sort((a, b) =>
    sortKey === "name" ? a.name.localeCompare(b.name) : a.balance - b.balance
  );

  return (
    <div>
      <TabGuide storageKey="stock-actual">
        Acá ves el saldo de INVESTOCK (el Kardex propio de DAFLOW) de cada producto del catálogo, calculado en tiempo real a partir de lo recibido en Compras y lo despachado en Egresos — sin depender de que alguien suba un archivo. Un saldo en rojo significa stock negativo (algo salió sin haber entrado, o hay un error de conteo por revisar).
      </TabGuide>
      <div className="flex items-center gap-2 mb-3">
        <div className="flex items-center gap-1.5 flex-1 rounded border border-rule px-2.5 py-1.5">
          <Search size={13} className="text-steel" />
          <input
            className="flex-1 text-[13px] outline-none bg-transparent"
            placeholder="Buscar producto o código…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <button
          type="button"
          className="flex items-center gap-1.5 rounded border border-rule px-3 py-1.5 text-[12px] font-semibold cursor-pointer whitespace-nowrap"
          onClick={() => setSortKey((k) => (k === "name" ? "balance" : "name"))}
        >
          <ArrowUpDown size={13} /> {sortKey === "name" ? "Ordenar por stock" : "Ordenar por nombre"}
        </button>
      </div>

      <div className="text-[12px] text-steel mb-2">{sorted.length} producto(s)</div>

      <div className="border border-rule rounded-md overflow-hidden">
        <div className="grid grid-cols-[1fr_auto_auto] gap-3 px-3 py-2 bg-cloud text-[10.5px] font-semibold uppercase tracking-wide text-steel">
          <span>Producto</span>
          <span className="text-right">Stock</span>
          <span className="text-right">Costo prom.</span>
        </div>
        <div className="max-h-[70vh] overflow-y-auto">
          {sorted.length === 0 ? (
            <div className="px-3 py-4 text-[12.5px] text-steel">Sin resultados.</div>
          ) : (
            // Confirmado 2026-09-10 (pedido explícito del usuario): con
            // nombres cortos y las columnas de número lejos a la derecha, se
            // perdía de vista qué fila conectaba con qué — franjas alternas
            // (zebra) le dan a cada fila un fondo propio que el ojo puede
            // seguir de punta a punta sin saltar a la fila de al lado.
            sorted.map((r, i) => (
              <div
                key={r.catalogItemId}
                className={`grid grid-cols-[1fr_auto_auto] gap-3 px-3 py-2 border-t border-rule items-center ${i % 2 === 1 ? "bg-cloud/40" : ""}`}
              >
                <span className="text-[12.5px] flex items-center gap-1.5 min-w-0">
                  <CatalogCode code={r.justCode} />
                  <span className="truncate">{r.name}</span>
                </span>
                <span className={`text-right font-mono text-[12.5px] font-bold ${r.balance < 0 ? "text-red" : "text-ink"}`}>{r.balance}</span>
                <span className="text-right font-mono text-[12px] text-steel">{money(r.avgCost)}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
