"use client";

import { useEffect, useState } from "react";
import { Search, CalendarClock, CheckCircle2 } from "lucide-react";
import { formatDateTime } from "@/lib/formatDateTime";

type CatalogItem = { id: string; name: string; justCode: string | null; hasExpiration: boolean };
type LotRow = { id: string; manufactureDate: string | null; expirationDate: string; quantityReceived: number; quantityRemaining: number; declaredAt: string };

const DATE_FMT = new Intl.DateTimeFormat("es-EC", { timeZone: "America/Guayaquil", day: "2-digit", month: "short", year: "numeric" });

// Confirmado 2026-09-10, pedido de Daniel: declarar el lote de un producto
// que YA está en percha (llegó antes de esta función, o nadie lo marcó a
// tiempo) — sin depender de esperar la próxima compra. Mismo lugar y
// permiso que "Etiquetas de percha".
export function ExpirationLotsPanel() {
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [manufactureDate, setManufactureDate] = useState("");
  const [expirationDate, setExpirationDate] = useState("");
  const [quantity, setQuantity] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");
  const [lots, setLots] = useState<LotRow[]>([]);
  const [loadingLots, setLoadingLots] = useState(false);

  useEffect(() => {
    fetch("/api/purchase-catalog").then((r) => (r.ok ? r.json() : [])).then(setItems).catch(() => setItems([]));
  }, []);

  const selected = items.find((i) => i.id === selectedId) ?? null;
  const filtered = query.trim()
    ? items.filter((i) => i.name.toLowerCase().includes(query.toLowerCase()) || (i.justCode ?? "").toLowerCase().includes(query.toLowerCase()))
    : items;

  function loadLots(catalogItemId: string) {
    setLoadingLots(true);
    fetch(`/api/purchase-catalog/${catalogItemId}/expiration-lots`)
      .then((r) => (r.ok ? r.json() : []))
      .then(setLots)
      .catch(() => setLots([]))
      .finally(() => setLoadingLots(false));
  }

  function selectItem(id: string) {
    setSelectedId(id);
    setManufactureDate("");
    setExpirationDate("");
    setQuantity("");
    setErr("");
    setOk("");
    loadLots(id);
  }

  async function declare() {
    if (!selected || !expirationDate || Number(quantity) <= 0) return;
    setBusy(true);
    setErr("");
    setOk("");
    const res = await fetch(`/api/purchase-catalog/${selected.id}/expiration-lots`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ manufactureDate: manufactureDate || null, expirationDate, quantity: Number(quantity) }),
    });
    setBusy(false);
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      setErr(data?.error ?? "No se pudo declarar el lote.");
      return;
    }
    setManufactureDate("");
    setExpirationDate("");
    setQuantity("");
    setOk("Lote declarado ✓");
    setItems((prev) => prev.map((i) => (i.id === selected.id ? { ...i, hasExpiration: true } : i)));
    loadLots(selected.id);
  }

  return (
    <div className="mt-6">
      <h3 className="text-[13.5px] font-bold text-ink mb-2">Lotes de caducidad</h3>
      <p className="text-[12px] text-steel mb-3">
        Declara el lote de un producto que ya está en percha (fecha de elaboración opcional, vencimiento y cantidad obligatorios) — no hace falta esperar a la próxima compra. Una vez declarado, el producto queda marcado para siempre: la próxima compra ya pide las fechas directo.
      </p>

      <div className="flex items-center gap-1.5 mb-2 rounded border border-rule px-2.5 py-1.5">
        <Search size={13} className="text-steel" />
        <input className="flex-1 text-[13px] outline-none bg-transparent" placeholder="Buscar producto o código…" value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>

      {!selected && (
        <div className="max-h-56 overflow-y-auto flex flex-col gap-1 border border-rule rounded-md p-1">
          {filtered.map((i) => (
            <button
              key={i.id}
              type="button"
              className="text-left flex items-center gap-2 text-[12.5px] px-2 py-1.5 rounded hover:bg-cloud cursor-pointer"
              onClick={() => selectItem(i.id)}
            >
              <span className="flex-1">{i.name}</span>
              {i.hasExpiration && (
                <span title="Ya tiene caducidad marcada">
                  <CalendarClock size={12} className="text-teal shrink-0" />
                </span>
              )}
              <span className="text-steel font-mono text-[11px] shrink-0">{i.justCode ?? i.id}</span>
            </button>
          ))}
          {filtered.length === 0 && <div className="text-[12px] text-steel px-2 py-2">Sin resultados.</div>}
        </div>
      )}

      {selected && (
        <div className="bg-cloud border border-rule rounded-md p-3">
          <div className="flex items-center justify-between gap-2 mb-3">
            <div className="text-[13px] font-semibold">{selected.name}</div>
            <button type="button" className="text-[11.5px] font-semibold text-blue cursor-pointer" onClick={() => setSelectedId(null)}>
              Cambiar producto
            </button>
          </div>

          <div className="grid grid-cols-3 gap-2 mb-2">
            <div>
              <label className="block text-[10px] text-steel mb-0.5">Elaboración (opcional)</label>
              <input type="date" className="w-full rounded border border-rule bg-surface px-2 py-1.5 text-[12px]" value={manufactureDate} onChange={(e) => setManufactureDate(e.target.value)} />
            </div>
            <div>
              <label className="block text-[10px] text-steel mb-0.5">Vencimiento</label>
              <input type="date" className="w-full rounded border border-rule bg-surface px-2 py-1.5 text-[12px]" value={expirationDate} onChange={(e) => setExpirationDate(e.target.value)} />
            </div>
            <div>
              <label className="block text-[10px] text-steel mb-0.5">Cantidad</label>
              <input type="number" min={1} className="w-full rounded border border-rule bg-surface px-2 py-1.5 text-[12px]" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
            </div>
          </div>
          {err && <div className="text-red text-[12px] mb-2">{err}</div>}
          {ok && (
            <div className="flex items-center gap-1.5 text-teal text-[12px] mb-2">
              <CheckCircle2 size={13} /> {ok}
            </div>
          )}
          <button
            type="button"
            disabled={busy || !expirationDate || Number(quantity) <= 0}
            className="rounded border border-teal bg-teal px-3.5 py-1.5 text-[12.5px] font-bold text-navy cursor-pointer disabled:opacity-40"
            onClick={declare}
          >
            {busy ? "Guardando…" : "Declarar lote"}
          </button>

          <div className="mt-4">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-steel mb-1.5">Lotes ya declarados</div>
            {loadingLots ? (
              <div className="text-[12px] text-steel">Cargando…</div>
            ) : lots.length === 0 ? (
              <div className="text-[12px] text-steel">Todavía no tiene ningún lote declarado.</div>
            ) : (
              <div className="flex flex-col gap-1.5">
                {lots.map((l) => (
                  <div key={l.id} className="bg-surface border border-rule rounded-md p-2 text-[12px] flex items-center justify-between gap-2">
                    <div>
                      <span className={l.quantityRemaining === 0 ? "text-steel" : "font-semibold text-ink"}>Vence {DATE_FMT.format(new Date(l.expirationDate))}</span>
                      {l.manufactureDate && <span className="text-steel"> · elaborado {DATE_FMT.format(new Date(l.manufactureDate))}</span>}
                      <div className="text-[10.5px] text-steel-dim">Declarado {formatDateTime(l.declaredAt)}</div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="font-mono font-bold">{l.quantityRemaining} / {l.quantityReceived}</div>
                      <div className="text-[10px] text-steel-dim">{l.quantityRemaining === 0 ? "agotado" : "disponible"}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
