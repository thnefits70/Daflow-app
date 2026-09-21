"use client";

import { useEffect, useRef, useState } from "react";
import { Search, CalendarClock, CheckCircle2, Trash2 } from "lucide-react";
import { formatDateTime } from "@/lib/formatDateTime";
import { CatalogCode } from "@/components/shared/CatalogCode";
import { useFormDraft } from "@/lib/useFormDraft";

type CatalogItem = { id: string; name: string; justCode: string | null; hasExpiration: boolean };
type LotRow = { id: string; manufactureDate: string | null; expirationDate: string; quantityReceived: number; quantityRemaining: number; declaredAt: string };
type ExpirationLotDraftData = { manufactureDate: string; expirationDate: string; quantity: string };
function isExpirationLotDraftEmpty(d: ExpirationLotDraftData) {
  return !d.manufactureDate && !d.expirationDate && !d.quantity;
}

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
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [markingExpiration, setMarkingExpiration] = useState(false);

  // Confirmado 2026-09-11, pedido de Daniel: poder hacer todo el formulario
  // con Enter, sin tocar el mouse — de un campo salta al siguiente, y desde
  // "Cantidad" Enter ya declara el lote directo.
  const expirationRef = useRef<HTMLInputElement>(null);
  const quantityRef = useRef<HTMLInputElement>(null);

  // Guardado automático: si sale a revisar otra cosa antes de declarar el
  // lote de este producto, al volver encuentra las fechas/cantidad tal
  // como las había dejado. Solo activo mientras hay un producto elegido.
  const draftKey = selectedId ? `expirationLot:${selectedId}` : null;
  const { clearDraft } = useFormDraft<ExpirationLotDraftData>(
    draftKey,
    { manufactureDate, expirationDate, quantity },
    (d) => {
      setManufactureDate(d.manufactureDate);
      setExpirationDate(d.expirationDate);
      setQuantity(d.quantity);
    },
    isExpirationLotDraftEmpty,
    "Lote de caducidad sin terminar",
    "/area/workspace?tab=reingreso"
  );

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
    setConfirmDeleteId(null);
    loadLots(id);
  }

  // Confirmado 2026-09-21, pedido puntual de Daniel: por esta vez, poder
  // borrar lotes declarados por error (pruebas, o fechas que el sistema le
  // cambió). Solo deja borrar lotes intactos (sin salidas ya descontadas).
  async function deleteLot(lotId: string) {
    if (!selected) return;
    setDeletingId(lotId);
    setErr("");
    const res = await fetch(`/api/purchase-catalog/${selected.id}/expiration-lots`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lotId }),
    });
    setDeletingId(null);
    setConfirmDeleteId(null);
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      setErr(data?.error ?? "No se pudo eliminar el lote.");
      return;
    }
    setLots((prev) => prev.filter((l) => l.id !== lotId));
    setItems((prev) => prev.map((i) => (i.id === selected.id && lots.length <= 1 ? { ...i, hasExpiration: false } : i)));
  }

  // Confirmado 2026-09-21, pedido de Daniel: si borrar el último lote apagó
  // hasExpiration de un producto que sí lo necesita, reactivarlo sin
  // obligarlo a declarar un lote real solo para "encenderlo" de nuevo.
  async function markNeedsExpiration() {
    if (!selected) return;
    setMarkingExpiration(true);
    setErr("");
    const res = await fetch(`/api/purchase-catalog/${selected.id}/expiration-lots`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ hasExpiration: true }),
    });
    setMarkingExpiration(false);
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setErr(data?.error ?? "No se pudo activar la marca.");
      return;
    }
    setItems((prev) => prev.map((i) => (i.id === selected.id ? { ...i, hasExpiration: true } : i)));
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
    clearDraft();
    setManufactureDate("");
    setExpirationDate("");
    setQuantity("");
    setItems((prev) => prev.map((i) => (i.id === selected.id ? { ...i, hasExpiration: true } : i)));
    // Confirmado 2026-09-15, pedido explícito de Daniel: al guardar un lote,
    // volver directo al buscador para el siguiente producto en vez de dejarlo
    // parado en la pantalla del producto que ya terminó — así declara varios
    // lotes seguidos más rápido, sin pasos extra de "Cambiar producto".
    setOk(`Lote de "${selected.name}" declarado ✓ — busca el siguiente producto.`);
    setSelectedId(null);
    setQuery("");
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

      {!selected && ok && (
        <div className="flex items-center gap-1.5 text-teal text-[12px] mb-2">
          <CheckCircle2 size={13} /> {ok}
        </div>
      )}

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
            <div className="text-[13px] font-semibold flex items-center gap-1.5">
              <CatalogCode code={selected.justCode} />
              <span>{selected.name}</span>
            </div>
            <button type="button" className="text-[11.5px] font-semibold text-blue cursor-pointer" onClick={() => setSelectedId(null)}>
              Cambiar producto
            </button>
          </div>

          {!selected.hasExpiration && (
            <div className="flex items-center justify-between gap-2 mb-3 bg-surface border border-rule rounded px-2.5 py-2">
              <span className="text-[11.5px] text-steel">Este producto no está marcado para pedir fecha de caducidad en la próxima compra.</span>
              <button
                type="button"
                disabled={markingExpiration}
                className="text-[11.5px] font-bold text-teal cursor-pointer shrink-0 disabled:opacity-40"
                onClick={markNeedsExpiration}
              >
                {markingExpiration ? "..." : "Sí la necesita"}
              </button>
            </div>
          )}

          <div className="grid grid-cols-3 gap-2 mb-2">
            <div>
              <label className="block text-[10px] text-steel mb-0.5">Elaboración (opcional) — día/mes/año</label>
              <input
                type="date"
                className="w-full rounded border border-rule bg-surface px-2 py-1.5 text-[12px]"
                value={manufactureDate}
                onChange={(e) => setManufactureDate(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); expirationRef.current?.focus(); } }}
              />
            </div>
            <div>
              <label className="block text-[10px] text-steel mb-0.5">Vencimiento — día/mes/año</label>
              <input
                ref={expirationRef}
                type="date"
                className="w-full rounded border border-rule bg-surface px-2 py-1.5 text-[12px]"
                value={expirationDate}
                onChange={(e) => setExpirationDate(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); quantityRef.current?.focus(); } }}
              />
            </div>
            <div>
              <label className="block text-[10px] text-steel mb-0.5">Cantidad</label>
              <input
                ref={quantityRef}
                type="number"
                min={1}
                className="w-full rounded border border-rule bg-surface px-2 py-1.5 text-[12px]"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); declare(); } }}
              />
            </div>
          </div>
          {err && <div className="text-red text-[12px] mb-2">{err}</div>}
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
                {lots.map((l) => {
                  const intact = l.quantityRemaining === l.quantityReceived;
                  return (
                    <div key={l.id} className="bg-surface border border-rule rounded-md p-2 text-[12px] flex items-center justify-between gap-2">
                      <div>
                        <span className={l.quantityRemaining === 0 ? "text-steel" : "font-semibold text-ink"}>Vence {DATE_FMT.format(new Date(l.expirationDate))}</span>
                        {l.manufactureDate && <span className="text-steel"> · elaborado {DATE_FMT.format(new Date(l.manufactureDate))}</span>}
                        <div className="text-[10.5px] text-steel-dim">Declarado {formatDateTime(l.declaredAt)}</div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <div className="text-right">
                          <div className="font-mono font-bold">{l.quantityRemaining} / {l.quantityReceived}</div>
                          <div className="text-[10px] text-steel-dim">{l.quantityRemaining === 0 ? "agotado" : "disponible"}</div>
                        </div>
                        {intact && (
                          confirmDeleteId === l.id ? (
                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                disabled={deletingId === l.id}
                                className="text-[10.5px] font-bold text-red border border-red rounded px-1.5 py-1 cursor-pointer disabled:opacity-40"
                                onClick={() => deleteLot(l.id)}
                              >
                                {deletingId === l.id ? "..." : "Confirmar"}
                              </button>
                              <button
                                type="button"
                                className="text-[10.5px] text-steel cursor-pointer px-1"
                                onClick={() => setConfirmDeleteId(null)}
                              >
                                Cancelar
                              </button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              title="Eliminar lote"
                              className="text-steel hover:text-red cursor-pointer p-1"
                              onClick={() => setConfirmDeleteId(l.id)}
                            >
                              <Trash2 size={13} />
                            </button>
                          )
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
