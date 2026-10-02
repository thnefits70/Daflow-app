"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import QRCode from "qrcode";
import { Search, Printer, CheckCheck } from "lucide-react";
import type { StockLabelPrintSummary } from "@/app/api/stock-label-prints/route";

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
  // Pedido de Daniel 2026-10-02: cuántas veces se imprimió cada QR y cuáles
  // aún no tienen etiqueta (arriba). "Imprimir" pregunta antes, porque cada
  // confirmación cuenta aunque luego se cancele la impresora.
  const [prints, setPrints] = useState<StockLabelPrintSummary>({});
  const [confirming, setConfirming] = useState<"print" | "manual" | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/purchase-catalog").then((r) => (r.ok ? r.json() : [])).then(setItems).catch(() => setItems([]));
    fetch("/api/stock-label-prints").then((r) => (r.ok ? r.json() : {})).then(setPrints).catch(() => setPrints({}));
  }, []);

  const isPrinted = (i: CatalogItem) => !!prints[i.id];
  const matches = query.trim()
    ? items.filter((i) => i.name.toLowerCase().includes(query.toLowerCase()) || (i.justCode ?? "").toLowerCase().includes(query.toLowerCase()))
    : items;
  const notPrinted = matches.filter((i) => !isPrinted(i));
  const printed = matches.filter(isPrinted);
  const filtered = [...notPrinted, ...printed];

  async function register(manual: boolean) {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/stock-label-prints", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ catalogItemIds: [...selected], manual }),
      });
      if (!res.ok) throw new Error();
      setPrints(await fetch("/api/stock-label-prints").then((r) => (r.ok ? r.json() : prints)));
      setConfirming(null);
      if (manual) setSelected(new Set());
      else window.print();
    } catch {
      setError("No se pudo guardar. Intenta de nuevo.");
    } finally {
      setSaving(false);
    }
  }

  function printLabel(i: CatalogItem): string {
    const p = prints[i.id];
    if (!p) return "Sin imprimir";
    if (p.count === 0) return "Ya impreso (antes)";
    const times = p.count === 1 ? "Impreso 1 vez" : `Impreso ${p.count} veces`;
    return p.manual ? `${times} + antes` : times;
  }
  function printTitle(i: CatalogItem): string | undefined {
    const p = prints[i.id];
    if (!p) return undefined;
    const when = new Date(p.lastAt).toLocaleString("es-EC", { timeZone: "America/Guayaquil", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
    return `Última vez: ${when} — ${p.lastBy}`;
  }

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
          onClick={() => setConfirming("print")}
        >
          <Printer size={13} /> Imprimir ({selected.size})
        </button>
      </div>

      {/* Botón momentáneo (pedido de Daniel 2026-10-02): marcar las etiquetas
          que ya imprimió antes de este registro. Él avisa cuando ya no lo
          necesite, para quitarlo. */}
      <div className="flex flex-wrap items-center gap-2 mb-3 print:hidden">
        <button
          type="button"
          disabled={selected.size === 0}
          className="flex items-center gap-1.5 rounded border border-rule px-3 py-1.5 text-[12px] font-semibold text-ink cursor-pointer disabled:opacity-60"
          onClick={() => setConfirming("manual")}
        >
          <CheckCheck size={13} /> Ya los tengo impresos ({selected.size})
        </button>
        <span className="text-[11.5px] text-steel">Marca los que ya están pegados en percha, sin imprimirlos de nuevo.</span>
      </div>

      {confirming && (
        <div className="mb-3 rounded-md border border-amber-500/60 bg-amber-500/10 px-3 py-2.5 text-[12.5px] print:hidden">
          <div className="font-semibold text-ink mb-1">¿Estás seguro?</div>
          <div className="text-steel mb-2">
            {confirming === "print"
              ? `Se van a imprimir ${selected.size} etiqueta(s) y quedarán contadas como impresas (aunque después canceles la impresora).`
              : `Se van a marcar ${selected.size} producto(s) como "ya impresos antes". No se imprime nada.`}
          </div>
          {error && <div className="text-red-500 mb-2">{error}</div>}
          <div className="flex gap-2">
            <button
              type="button"
              disabled={saving}
              className="rounded border border-blue bg-blue px-3 py-1 text-[12px] font-semibold text-white cursor-pointer disabled:opacity-60"
              onClick={() => register(confirming === "manual")}
            >
              {saving ? "Guardando…" : confirming === "print" ? "Sí, imprimir" : "Sí, marcar"}
            </button>
            <button
              type="button"
              disabled={saving}
              className="rounded border border-rule px-3 py-1 text-[12px] font-semibold text-ink cursor-pointer"
              onClick={() => {
                setConfirming(null);
                setError(null);
              }}
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

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
        {filtered.map((i, idx) => (
          <div key={i.id}>
            {idx === 0 && notPrinted.length > 0 && (
              <div className="flex items-center justify-between px-2 pt-1 pb-0.5 text-[11.5px] font-bold text-amber-500">
                <span>Aún sin imprimir ({notPrinted.length})</span>
                <button
                  type="button"
                  className="text-[11.5px] font-semibold text-blue cursor-pointer"
                  onClick={() => setSelected((prev) => new Set([...prev, ...notPrinted.map((x) => x.id)]))}
                >
                  Marcar estos
                </button>
              </div>
            )}
            {idx === notPrinted.length && printed.length > 0 && <div className="px-2 pt-2 pb-0.5 text-[11.5px] font-bold text-steel">Ya impresos ({printed.length})</div>}
            <label className="flex items-center gap-2 text-[12.5px] px-2 py-1 rounded hover:bg-cloud cursor-pointer">
              <input type="checkbox" checked={selected.has(i.id)} onChange={() => toggle(i.id)} />
              <span className="flex-1">
                {i.name} <span className="text-steel font-mono text-[11px]">({stockCodeFor(i)})</span>
              </span>
              <span title={printTitle(i)} className={`shrink-0 text-[11px] font-semibold ${isPrinted(i) ? "text-steel" : "text-amber-500"}`}>
                {printLabel(i)}
              </span>
            </label>
          </div>
        ))}
      </div>

      {selectedItems.length > 0 && (
        <div className="mt-4 grid grid-cols-2 sm:grid-cols-3 gap-4 print:hidden">
          {selectedItems.map((i) => {
            const code = stockCodeFor(i);
            const qr = qrByCode[code];
            return (
              <div key={i.id} className="border border-rule rounded-md p-3 text-center">
                <div className="text-[12px] font-semibold text-ink mb-2 line-clamp-2">{i.name}</div>
                {qr && <img src={qr} alt={code} className="mx-auto w-28 h-28" />}
                <div className="text-[11px] font-mono text-steel mt-1">{code}</div>
              </div>
            );
          })}
        </div>
      )}

      {/* Fix 2026-09-23 (etiquetas salían corridas en el sticker de 10x10cm):
          lo que se imprime vive directo en <body>, fuera de los márgenes y
          rellenos de la app — antes esos espacios empujaban la primera
          etiqueta hacia abajo y un nombre de 2 líneas hacía que la etiqueta
          midiera más de 10cm, así que el sobrante caía en el sticker
          siguiente y todo quedaba descuadrado. selectedItems empieza vacío,
          así que el portal nunca se arma en el primer render. */}
      {selectedItems.length > 0 &&
        createPortal(
          <div className="stock-label-print-root">
            {selectedItems.map((i) => {
              const code = stockCodeFor(i);
              const qr = qrByCode[code];
              return (
                <div key={i.id} className="print-stock-label">
                  <div className="print-stock-label__name">{i.name}</div>
                  {qr && <img src={qr} alt={code} className="print-stock-label__qr" />}
                  <div className="print-stock-label__code">{code}</div>
                </div>
              );
            })}
          </div>,
          document.body,
        )}
    </div>
  );
}
