"use client";

import { useEffect, useState } from "react";
import { Search, ArrowUpDown, Info, X } from "lucide-react";
import { CatalogCode } from "@/components/shared/CatalogCode";
import { TabGuide } from "@/components/shared/TabGuide";

type StockRow = {
  catalogItemId: string;
  name: string;
  justCode: string | null;
  photos: string[];
  balance: number;
  avgCost: number;
  benistockPrice?: number;
  b2bPriceDefault?: number;
  b2cPrice1Unit?: number;
  b2cPrice2to11?: number;
};
type SortKey = "name" | "balance";
type FormulaKey = "benistock" | "b2b" | "b2c1" | "b2c2";

function money(v: number) {
  return "$" + v.toLocaleString("es-EC", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Confirmado 2026-09-15, pedido explícito del usuario: quiere ver, con un
// clic, exactamente qué fórmula se está calculando en cada columna de
// precio — mismas fórmulas ya usadas en src/lib/marketProduct.ts
// (computeBenistockPrice/computeB2BPrice/computeB2CPrice), explicadas en
// palabras simples, no en código.
const FORMULA_EXPLANATIONS: Record<FormulaKey, { title: string; text: string }> = {
  benistock: {
    title: "Benistock",
    text: "Costo puesto en bodega (proveedor + flete por unidad) × 1.06 (6% de seguro) + $0.75 (fulfillment). Es el costo real, sin ninguna ganancia — solo de referencia.",
  },
  b2b: {
    title: "B2B",
    text: "Costo puesto en bodega × 1.06 (6% de seguro) ÷ (1 − 20%). El 20% es el margen de ganancia por defecto para venta al por mayor.",
  },
  b2c1: {
    title: "B2C · 1 unidad",
    text: "Costo puesto en bodega × 1.06 (6% de seguro) ÷ (1 − 40%) + $7.50 (flete promedio), redondeado hacia arriba a .99. El 40% es el margen cuando se vende 1 sola unidad.",
  },
  b2c2: {
    title: "B2C · 2 a 11 unidades",
    text: "Igual que B2C de 1 unidad, pero con 30% de margen en vez de 40% — el margen baja cuando se venden de 2 a 11 unidades en la misma venta. De 12 en adelante ya no es B2C.",
  },
};

function FormulaInfoButton({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <button type="button" className="inline-flex items-center cursor-pointer text-steel hover:text-ink" title="Ver cómo se calcula" onClick={onToggle}>
      <Info size={11} className={open ? "text-blue" : undefined} />
    </button>
  );
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
  const [openFormula, setOpenFormula] = useState<FormulaKey | null>(null);

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

      {/* Confirmado 2026-09-15, pedido explícito del usuario: la primera
          versión (8 columnas parejas, todas del mismo tamaño y color) se
          veía chica y confundía cuál precio era cuál. Ahora se agrupan
          visualmente en dos bloques con su propio encabezado y separador:
          "Costo" (lo que ya cuesta tenerlo) vs. "Precios de venta" (a qué
          venderlo en cada canal) — y cada precio de venta lleva su color
          fijo (B2B teal, B2C azul) en todas las pantallas de la app. */}
      {/* Confirmado 2026-09-15, pedido explícito del usuario: con columnas de
          ancho "auto" (se ajustan a su contenido), Producto (1fr) se comía
          todo el espacio libre y el resto quedaba apiñado a la derecha,
          dejando un vacío enorme en el medio. Ahora cada columna de número
          tiene un ancho fijo — se reparten parejo por toda la fila. */}
      <div className="border border-rule rounded-md overflow-x-auto">
        <div className="grid grid-cols-[auto_minmax(200px,1fr)_90px_110px_110px_110px_110px_120px] gap-3 px-3 pt-2 min-w-[1000px]">
          <span></span>
          <span></span>
          <span></span>
          <span className="col-span-2 text-center text-[10px] font-bold uppercase tracking-wide text-steel border-b border-rule pb-1">Costo</span>
          <span className="col-span-3 text-center text-[10px] font-bold uppercase tracking-wide text-blue border-b border-rule pb-1">Precios de venta</span>
        </div>
        <div className="grid grid-cols-[auto_minmax(200px,1fr)_90px_110px_110px_110px_110px_120px] gap-3 px-3 py-2 bg-cloud text-[11px] font-semibold uppercase tracking-wide text-steel min-w-[1000px]">
          <span></span>
          <span>Producto</span>
          <span className="text-right">Stock</span>
          <span className="text-right border-l border-rule pl-3">Costo prom.</span>
          <span className="flex items-center justify-end gap-1">
            Benistock <FormulaInfoButton open={openFormula === "benistock"} onToggle={() => setOpenFormula((k) => (k === "benistock" ? null : "benistock"))} />
          </span>
          <span className="flex items-center justify-end gap-1 border-l border-rule pl-3 text-teal">
            B2B <FormulaInfoButton open={openFormula === "b2b"} onToggle={() => setOpenFormula((k) => (k === "b2b" ? null : "b2b"))} />
          </span>
          <span className="flex items-center justify-end gap-1 text-blue">
            B2C 1 un. <FormulaInfoButton open={openFormula === "b2c1"} onToggle={() => setOpenFormula((k) => (k === "b2c1" ? null : "b2c1"))} />
          </span>
          <span className="flex items-center justify-end gap-1 text-blue">
            B2C 2-11 un. <FormulaInfoButton open={openFormula === "b2c2"} onToggle={() => setOpenFormula((k) => (k === "b2c2" ? null : "b2c2"))} />
          </span>
        </div>
        {openFormula && (
          <div className="flex items-start justify-between gap-3 bg-navy border-b border-rule px-3 py-2.5 min-w-[1000px]">
            <div className="text-[12px]">
              <span className="font-bold text-ink">{FORMULA_EXPLANATIONS[openFormula].title}: </span>
              <span className="text-steel">{FORMULA_EXPLANATIONS[openFormula].text}</span>
            </div>
            <button type="button" className="shrink-0 text-steel hover:text-ink cursor-pointer" onClick={() => setOpenFormula(null)}>
              <X size={13} />
            </button>
          </div>
        )}
        <div className="max-h-[70vh] overflow-y-auto min-w-[1000px]">
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
                className={`grid grid-cols-[auto_minmax(200px,1fr)_90px_110px_110px_110px_110px_120px] gap-3 px-3 py-2.5 border-t border-rule items-center ${i % 2 === 1 ? "bg-cloud/40" : ""}`}
              >
                {r.photos[0] ? (
                  // Confirmado 2026-09-15 (pedido de Daniel): foto real del
                  // catálogo junto al stock, para verificar que el producto
                  // contado es el mismo que corresponde al código — doble
                  // clic la amplía (GlobalImageZoom).
                  <img src={r.photos[0]} alt="" className="w-8 h-8 rounded object-cover border border-rule shrink-0" />
                ) : (
                  <div className="w-8 h-8 rounded border border-dashed border-rule shrink-0" />
                )}
                <span className="text-[12.5px] flex items-center gap-1.5 min-w-0">
                  <CatalogCode code={r.justCode} />
                  <span className="truncate">{r.name}</span>
                </span>
                <span className={`text-right font-mono text-[12.5px] font-bold ${r.balance < 0 ? "text-red" : "text-ink"}`}>{r.balance}</span>
                <span className="text-right font-mono text-[13px] text-steel border-l border-rule pl-3">{money(r.avgCost)}</span>
                <span className="text-right font-mono text-[13px] text-steel">{r.benistockPrice != null ? money(r.benistockPrice) : "—"}</span>
                <span className="text-right font-mono text-[13px] font-bold text-teal border-l border-rule pl-3">{r.b2bPriceDefault != null ? money(r.b2bPriceDefault) : "—"}</span>
                <span className="text-right font-mono text-[13px] font-bold text-blue">{r.b2cPrice1Unit != null ? money(r.b2cPrice1Unit) : "—"}</span>
                <span className="text-right font-mono text-[13px] font-bold text-blue">{r.b2cPrice2to11 != null ? money(r.b2cPrice2to11) : "—"}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
