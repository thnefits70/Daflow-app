"use client";

import { useEffect, useState } from "react";
import { Search, ArrowUpDown, Info, X, Wrench } from "lucide-react";
import { CatalogCode } from "@/components/shared/CatalogCode";
import { TabGuide } from "@/components/shared/TabGuide";

type FreightRecomputeRow = { catalogItemId: string; name: string; entriesChanged: number; oldAvgCost: number; newAvgCost: number };

// Confirmado 2026-09-16, pedido explícito del usuario: los combos de Dropi
// (DropiCombo) no son productos reales — no tienen ni deben tener su propio
// stock. Se muestran acá aparte, solo como referencia (código/nombre +
// productos reales que traen), y el stock de CADA producto que lo compone
// se saca cruzando por catalogItemId contra la misma lista de arriba —
// nunca se inventa un stock para el combo en sí.
type ComboRow = {
  id: string;
  code: string;
  label: string | null;
  components: { id: string; quantity: number; catalogItem: { id: string; name: string; justCode: string | null } }[];
  benistockPrice: number | null;
  b2bPriceDefault: number | null;
  dropiPrice: number | null;
  b2cPrice1Unit: number | null;
  b2cPrice2to11: number | null;
};

type StockRow = {
  catalogItemId: string;
  name: string;
  justCode: string | null;
  photos: string[];
  balance: number;
  avgCost: number;
  providerPrice?: number;
  bodegaPrice?: number;
  benistockPrice?: number;
  b2bPriceDefault?: number;
  dropiPrice?: number;
  b2cPrice1Unit?: number;
  b2cPrice2to11?: number;
};
type SortKey = "name" | "balance";
// Confirmado 2026-09-16, pedido explícito del usuario: poder ver solo los
// productos reales, solo los combos, o ambos juntos, con un clic.
type ViewMode = "all" | "products" | "combos";
type FormulaKey = "proveedor" | "bodega" | "benistock" | "b2b" | "dropi" | "b2c1" | "b2c2";

function money(v: number) {
  return "$" + v.toLocaleString("es-EC", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Confirmado 2026-09-16, pedido explícito del usuario: poder copiar
// cualquier precio con un clic, sin agregar íconos ni botones nuevos que
// ensucien la tabla — clic sobre el número mismo, y por un instante se
// convierte en un "✓" antes de volver a mostrar el precio.
function CopyableAmount({ value, className }: { value: number | null | undefined; className: string }) {
  const [copied, setCopied] = useState(false);
  if (value == null) return <span className={className}>—</span>;
  return (
    <span
      className={`${className} cursor-pointer hover:underline`}
      title="Clic para copiar"
      onClick={() => {
        navigator.clipboard?.writeText(money(value)).catch(() => null);
        setCopied(true);
        setTimeout(() => setCopied(false), 900);
      }}
    >
      {copied ? "✓" : money(value)}
    </span>
  );
}

// Confirmado 2026-09-16, bug real reportado por el usuario: buscar "Máquina
// Anti Ronquidos" (con tilde) no encontraba nada porque el nombre real en el
// catálogo está sin tilde ("Maquina") — la búsqueda comparaba texto exacto,
// sin ignorar acentos. Mismo criterio ya usado en otras búsquedas de la app
// (ej. PurchasePriceExplorer.tsx).
function normalize(s: string) {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

// Confirmado 2026-09-16, pedido explícito del usuario: buscar "Afeitadora
// Snar 3 en 1" no encontraba "Afeitadora 2 en 1" porque exigía el texto
// completo tal cual, incluyendo palabras que el usuario recordaba mal. Mismo
// criterio de "palabras significativas" ya usado en justCatalog.ts
// (findSimilarUnlinkedItem) — se ignoran palabras de relleno/números
// sueltos, y basta con que UNA palabra clave real coincida para aparecer en
// la lista (ordenado por cuántas palabras coinciden, para que el mejor
// resultado salga primero).
const SEARCH_STOPWORDS = new Set(["de", "del", "la", "el", "los", "las", "un", "una", "unos", "unas", "y", "o", "con", "para", "por", "en", "a", "al", "tipo"]);
function significantWords(s: string): string[] {
  return normalize(s)
    .split(/\s+/)
    .filter((w) => w.length >= 2 && !SEARCH_STOPWORDS.has(w));
}

// Confirmado 2026-09-15, pedido explícito del usuario: quiere ver, con un
// clic, exactamente qué fórmula se está calculando en cada columna de
// precio — mismas fórmulas ya usadas en src/lib/marketProduct.ts
// (computeBenistockPrice/computeB2BPrice/computeB2CPrice), explicadas en
// palabras simples, no en código.
const FORMULA_EXPLANATIONS: Record<FormulaKey, { title: string; text: string }> = {
  proveedor: {
    title: "Precio proveedor",
    text: "Lo que cobra el proveedor por una unidad, tal cual — sin sumarle flete ni nada más. Es el mismo costo real que ya usa el Kardex de INVESTOCK (el promedio ponderado de todas las compras).",
  },
  bodega: {
    title: "Puesto en bodega",
    text: "Precio proveedor + la parte del flete del lote que le toca a esa unidad. Para productos que nunca pasaron por la calculadora de Análisis de Mercado no se conoce el flete por separado todavía, así que este número sale igual al precio proveedor.",
  },
  benistock: {
    title: "Benistock",
    text: "Costo puesto en bodega (proveedor + flete por unidad) × 1.06 (6% de seguro) + $0.75 (fulfillment). Es el costo real, sin ninguna ganancia — solo de referencia.",
  },
  b2b: {
    title: "B2B",
    text: "Costo puesto en bodega × 1.06 (6% de seguro) ÷ (1 − 20%). El 20% es el margen de ganancia por defecto para venta al por mayor.",
  },
  dropi: {
    title: "Precio Dropi",
    text: "Puesto en bodega × 1.06 (6% de seguro) + fulfillment, ÷ (1 − margen). Es el precio que usa Jariel para decidir si le conviene comprar un producto — 20% de margen por defecto, salvo que el producto ya tenga uno propio calculado en Análisis de Mercado.",
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
export function StockLevelsPanel({ isAdmin = false }: { isAdmin?: boolean }) {
  const [rows, setRows] = useState<StockRow[] | null>(null);
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [viewMode, setViewMode] = useState<ViewMode>("all");
  const [openFormula, setOpenFormula] = useState<FormulaKey | null>(null);

  // Confirmado 2026-09-16, pedido explícito del usuario: corrección única del
  // historial de Kardex para que "Costo Prom." incluya el flete real de
  // compras viejas, no solo de las nuevas (ver applyKardexFreightRecompute
  // en stockKardex.ts) — exclusivo admin, primero vista previa (solo
  // lectura), después aplicar de verdad con confirmación explícita.
  const [freightOpen, setFreightOpen] = useState(false);
  const [freightLoading, setFreightLoading] = useState(false);
  const [freightPreview, setFreightPreview] = useState<FreightRecomputeRow[] | null>(null);
  const [freightConfirming, setFreightConfirming] = useState(false);
  const [freightApplying, setFreightApplying] = useState(false);
  const [freightResult, setFreightResult] = useState<{ itemsChanged: number; entriesUpdated: number } | null>(null);
  const [freightError, setFreightError] = useState("");
  const [combos, setCombos] = useState<ComboRow[]>([]);

  function loadRows() {
    fetch("/api/inventory-control/stock-levels")
      .then((r) => (r.ok ? r.json() : []))
      .then(setRows)
      .catch(() => setRows([]));
  }

  useEffect(() => {
    loadRows();
    fetch("/api/dropi-combos")
      .then((r) => (r.ok ? r.json() : []))
      .then(setCombos)
      .catch(() => setCombos([]));
  }, []);

  function loadFreightPreview() {
    setFreightLoading(true);
    setFreightError("");
    setFreightResult(null);
    fetch("/api/inventory-control/kardex-recompute-freight")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(setFreightPreview)
      .catch(() => setFreightError("No se pudo cargar la vista previa."))
      .finally(() => setFreightLoading(false));
  }

  async function applyFreightRecompute() {
    setFreightApplying(true);
    setFreightError("");
    const res = await fetch("/api/inventory-control/kardex-recompute-freight", { method: "POST" });
    setFreightApplying(false);
    setFreightConfirming(false);
    if (!res.ok) {
      setFreightError("No se pudo aplicar la corrección.");
      return;
    }
    const data = await res.json();
    setFreightResult(data);
    setFreightPreview(null);
    loadRows();
  }

  if (rows === null) return <div className="text-steel text-[13px]">Cargando…</div>;

  const queryTrimmed = query.trim();
  const queryWords = queryTrimmed ? significantWords(queryTrimmed) : [];
  const filtered = !queryTrimmed
    ? rows
    : rows
        .map((r) => {
          const nameNorm = normalize(r.name);
          const directMatch = nameNorm.includes(normalize(queryTrimmed)) || (r.justCode ?? "").toLowerCase().includes(queryTrimmed.toLowerCase());
          const matchCount = queryWords.filter((w) => nameNorm.includes(w)).length;
          return { row: r, directMatch, matchCount };
        })
        .filter((x) => x.directMatch || x.matchCount > 0)
        .sort((a, b) => Number(b.directMatch) - Number(a.directMatch) || b.matchCount - a.matchCount)
        .map((x) => x.row);

  // Mientras hay una búsqueda activa, se ordena por qué tan buena es la
  // coincidencia (arriba) — el toggle de orden manual solo aplica sin buscar.
  const sorted = queryTrimmed
    ? filtered
    : [...filtered].sort((a, b) => (sortKey === "name" ? a.name.localeCompare(b.name) : a.balance - b.balance));

  return (
    <div>
      <TabGuide storageKey="stock-actual">
        Acá ves el saldo de INVESTOCK (el Kardex propio de DAFLOW) de cada producto del catálogo, calculado en tiempo real a partir de lo recibido en Compras y lo despachado en Egresos — sin depender de que alguien suba un archivo. Un saldo en rojo significa stock negativo (algo salió sin haber entrado, o hay un error de conteo por revisar).
      </TabGuide>

      {isAdmin && (
        <div className="border border-rule rounded-md mb-3">
          <button
            type="button"
            className="w-full flex items-center gap-2 px-3 py-2 text-[12px] font-semibold text-steel hover:text-ink cursor-pointer"
            onClick={() => {
              setFreightOpen((v) => !v);
              if (!freightOpen && freightPreview === null && !freightResult) loadFreightPreview();
            }}
          >
            <Wrench size={13} /> Corregir Costo Prom. con el flete real de compras viejas
          </button>
          {freightOpen && (
            <div className="px-3 pb-3 text-[12px]">
              <p className="text-steel mb-2">
                Recalcula el &quot;Costo Prom.&quot; de todos los productos para que las compras de antes de hoy también sumen el flete real que ya pagaste (donde aplicó — un proveedor que nunca cobra flete aparte no cambia). Las ventas/salidas ya hechas se quedan tal como están anotadas, no se tocan. Es seguro correr esto más de una vez.
              </p>
              {freightError && <div className="text-red mb-2">{freightError}</div>}
              {freightLoading && <div className="text-steel">Calculando vista previa…</div>}
              {freightResult && (
                <div className="text-teal font-semibold mb-2">
                  ✓ Corregido: {freightResult.itemsChanged} producto{freightResult.itemsChanged === 1 ? "" : "s"} actualizado{freightResult.itemsChanged === 1 ? "" : "s"} ({freightResult.entriesUpdated} línea{freightResult.entriesUpdated === 1 ? "" : "s"} de Kardex).
                </div>
              )}
              {!freightLoading && freightPreview && (
                <>
                  {freightPreview.length === 0 ? (
                    <div className="text-steel">Ningún producto cambiaría — el historial ya está al día.</div>
                  ) : (
                    <>
                      <div className="text-steel mb-1.5">{freightPreview.length} producto(s) cambiarían:</div>
                      <div className="max-h-52 overflow-y-auto flex flex-col gap-1 mb-2.5 border border-rule rounded-md p-1.5">
                        {freightPreview.map((r) => (
                          <div key={r.catalogItemId} className="flex items-center justify-between gap-2 text-[11.5px] px-1.5 py-1">
                            <span className="truncate flex-1">{r.name}</span>
                            <span className="font-mono text-steel shrink-0">
                              {money(r.oldAvgCost)} → <span className="font-bold text-ink">{money(r.newAvgCost)}</span>
                            </span>
                          </div>
                        ))}
                      </div>
                      {freightConfirming ? (
                        <div className="flex items-center gap-2">
                          <span className="text-steel">¿Aplicar esta corrección a la base real?</span>
                          <button
                            type="button"
                            disabled={freightApplying}
                            className="font-bold text-red cursor-pointer disabled:opacity-50"
                            onClick={applyFreightRecompute}
                          >
                            {freightApplying ? "Aplicando…" : "Sí, aplicar"}
                          </button>
                          <button type="button" className="text-steel cursor-pointer" onClick={() => setFreightConfirming(false)}>
                            Cancelar
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          className="rounded border border-teal bg-teal px-3 py-1.5 text-[12px] font-bold text-navy cursor-pointer"
                          onClick={() => setFreightConfirming(true)}
                        >
                          Aplicar corrección
                        </button>
                      )}
                    </>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      )}

      <div className="flex items-center gap-1.5 mb-3">
        <button
          type="button"
          className={`rounded-full px-3 py-1.5 text-[12px] font-semibold cursor-pointer border ${viewMode === "all" ? "bg-teal border-teal text-navy" : "border-rule text-steel hover:text-ink"}`}
          onClick={() => setViewMode("all")}
        >
          Todo
        </button>
        <button
          type="button"
          className={`rounded-full px-3 py-1.5 text-[12px] font-semibold cursor-pointer border ${viewMode === "products" ? "bg-teal border-teal text-navy" : "border-rule text-steel hover:text-ink"}`}
          onClick={() => setViewMode("products")}
        >
          Solo productos
        </button>
        <button
          type="button"
          className={`rounded-full px-3 py-1.5 text-[12px] font-semibold cursor-pointer border ${viewMode === "combos" ? "bg-teal border-teal text-navy" : "border-rule text-steel hover:text-ink"}`}
          onClick={() => setViewMode("combos")}
        >
          Solo combos
        </button>
      </div>

      {viewMode !== "combos" && (
        <>
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
        <div className="grid grid-cols-[auto_minmax(200px,1fr)_90px_100px_110px_110px_100px_100px_110px_110px] gap-3 px-3 pt-2 min-w-[1300px]">
          <span></span>
          <span></span>
          <span></span>
          <span className="col-span-3 text-center text-[10px] font-bold uppercase tracking-wide text-steel border-b border-rule pb-1">Costo</span>
          <span className="col-span-4 text-center text-[10px] font-bold uppercase tracking-wide text-blue border-b border-rule pb-1">Precios de venta</span>
        </div>
        <div className="grid grid-cols-[auto_minmax(200px,1fr)_90px_100px_110px_110px_100px_100px_110px_110px] gap-3 px-3 py-2 bg-cloud text-[11px] font-semibold uppercase tracking-wide text-steel min-w-[1300px]">
          <span></span>
          <span>Producto</span>
          <span className="text-right">Stock</span>
          <span className="flex items-center justify-end gap-1 border-l border-rule pl-3">
            Proveedor <FormulaInfoButton open={openFormula === "proveedor"} onToggle={() => setOpenFormula((k) => (k === "proveedor" ? null : "proveedor"))} />
          </span>
          <span className="flex items-center justify-end gap-1">
            Puesto en bodega <FormulaInfoButton open={openFormula === "bodega"} onToggle={() => setOpenFormula((k) => (k === "bodega" ? null : "bodega"))} />
          </span>
          <span className="flex items-center justify-end gap-1">
            Benistock <FormulaInfoButton open={openFormula === "benistock"} onToggle={() => setOpenFormula((k) => (k === "benistock" ? null : "benistock"))} />
          </span>
          <span className="flex items-center justify-end gap-1 border-l border-rule pl-3 text-teal">
            B2B <FormulaInfoButton open={openFormula === "b2b"} onToggle={() => setOpenFormula((k) => (k === "b2b" ? null : "b2b"))} />
          </span>
          <span className="flex items-center justify-end gap-1">
            Dropi <FormulaInfoButton open={openFormula === "dropi"} onToggle={() => setOpenFormula((k) => (k === "dropi" ? null : "dropi"))} />
          </span>
          <span className="flex items-center justify-end gap-1 text-blue">
            B2C 1 un. <FormulaInfoButton open={openFormula === "b2c1"} onToggle={() => setOpenFormula((k) => (k === "b2c1" ? null : "b2c1"))} />
          </span>
          <span className="flex items-center justify-end gap-1 text-blue">
            B2C 2-11 un. <FormulaInfoButton open={openFormula === "b2c2"} onToggle={() => setOpenFormula((k) => (k === "b2c2" ? null : "b2c2"))} />
          </span>
        </div>
        {openFormula && (
          <div className="flex items-start justify-between gap-3 bg-navy border-b border-rule px-3 py-2.5 min-w-[1300px]">
            <div className="text-[12px]">
              <span className="font-bold text-ink">{FORMULA_EXPLANATIONS[openFormula].title}: </span>
              <span className="text-steel">{FORMULA_EXPLANATIONS[openFormula].text}</span>
            </div>
            <button type="button" className="shrink-0 text-steel hover:text-ink cursor-pointer" onClick={() => setOpenFormula(null)}>
              <X size={13} />
            </button>
          </div>
        )}
        <div className="max-h-[70vh] overflow-y-auto min-w-[1300px]">
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
                className={`grid grid-cols-[auto_minmax(200px,1fr)_90px_100px_110px_110px_100px_100px_110px_110px] gap-3 px-3 py-2.5 border-t border-rule items-center ${i % 2 === 1 ? "bg-cloud/40" : ""}`}
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
                <CopyableAmount value={r.providerPrice} className="text-right font-mono text-[13px] text-steel border-l border-rule pl-3" />
                <CopyableAmount value={r.bodegaPrice} className="text-right font-mono text-[13px] text-steel" />
                <CopyableAmount value={r.benistockPrice} className="text-right font-mono text-[13px] text-steel" />
                <CopyableAmount value={r.b2bPriceDefault} className="text-right font-mono text-[13px] font-bold text-teal border-l border-rule pl-3" />
                <CopyableAmount value={r.dropiPrice} className="text-right font-mono text-[13px] font-bold text-ink" />
                <CopyableAmount value={r.b2cPrice1Unit} className="text-right font-mono text-[13px] font-bold text-blue" />
                <CopyableAmount value={r.b2cPrice2to11} className="text-right font-mono text-[13px] font-bold text-blue" />
              </div>
            ))
          )}
        </div>
      </div>
        </>
      )}

      {viewMode === "combos" && combos.length === 0 && (
        <div className="px-3 py-4 text-[12.5px] text-steel">Todavía no hay combos registrados.</div>
      )}

      {viewMode !== "products" && combos.length > 0 && (
        <div className="mt-5">
          <div className="text-[13px] font-bold text-ink mb-1">Combos registrados</div>
          <div className="text-[11.5px] text-steel mb-2.5">
            Un combo no es un producto real — no tiene stock propio. Acá ves qué productos reales trae cada uno y cuánto stock real le queda a cada uno, para saber de un vistazo si alcanza para seguir armándolo.
          </div>
          <div className="flex flex-col gap-2">
            {combos.map((combo) => (
              <div key={combo.id} className="bg-surface border border-rule rounded-md p-3">
                <div className="flex items-center gap-2 mb-2">
                  <span className="font-mono text-[11.5px] font-bold text-teal">{combo.code}</span>
                  {combo.label && <span className="text-[12px] text-steel">{combo.label}</span>}
                </div>
                <div className="flex flex-wrap gap-1.5 mb-2.5">
                  {combo.components.map((c) => {
                    const stockRow = rows?.find((r) => r.catalogItemId === c.catalogItem.id);
                    const stock = stockRow?.balance ?? null;
                    return (
                      <span key={c.id} className="inline-flex items-center gap-1.5 text-[12px] bg-cloud border border-rule rounded-full px-2.5 py-1">
                        <CatalogCode code={c.catalogItem.justCode} />
                        <span>{c.quantity}× {c.catalogItem.name}</span>
                        <span className={`font-mono font-bold ${stock != null && stock < 0 ? "text-red" : "text-steel"}`}>
                          ({stock != null ? `stock: ${stock}` : "sin dato"})
                        </span>
                      </span>
                    );
                  })}
                </div>
                {combo.benistockPrice == null ? (
                  <div className="text-[11px] text-steel">Sin precios — a algún producto de este combo le falta el costo registrado.</div>
                ) : (
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] border-t border-rule pt-2">
                    <span className="text-steel">Benistock <CopyableAmount value={combo.benistockPrice} className="font-mono font-bold text-steel" /></span>
                    <span className="text-teal">B2B <CopyableAmount value={combo.b2bPriceDefault} className="font-mono font-bold text-teal" /></span>
                    <span className="text-ink">Dropi <CopyableAmount value={combo.dropiPrice} className="font-mono font-bold text-ink" /></span>
                    <span className="text-blue">B2C 1 un. <CopyableAmount value={combo.b2cPrice1Unit} className="font-mono font-bold text-blue" /></span>
                    <span className="text-blue">B2C 2-11 un. <CopyableAmount value={combo.b2cPrice2to11} className="font-mono font-bold text-blue" /></span>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
