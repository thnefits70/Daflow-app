"use client";

import { useEffect, useState } from "react";

type Row = { catalogItemId: string; code: string; name: string; photo: string | null; rank: number; unitsRange: string };

// Pedido del usuario 2026-10-12 — ver lib/dropiPriceMissing.ts. Productos que
// se venden en provedix.com sin Precio Dropi registrado: la asesora B2B
// escribe UNA vez el precio que está PUBLICADO EN DROPI (no el de INVESTOCK).
export function DropiPriceMissingQueue() {
  const [rows, setRows] = useState<Row[]>([]);
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<{ id: string; msg: string } | null>(null);

  function load() {
    fetch("/api/market-products/dropi-price-missing").then((r) => (r.ok ? r.json() : [])).then(setRows).catch(() => setRows([]));
  }
  useEffect(load, []);

  async function save(r: Row) {
    setErr(null);
    const price = Number((values[r.catalogItemId] ?? "").replace(",", "."));
    if (!(price > 0)) {
      setErr({ id: r.catalogItemId, msg: "Escribe el precio que ves publicado en Dropi." });
      return;
    }
    setBusy(r.catalogItemId);
    const res = await fetch("/api/market-products/dropi-price-missing", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ catalogItemId: r.catalogItemId, price }),
    }).catch(() => null);
    setBusy(null);
    if (!res?.ok) {
      const d = await res?.json().catch(() => ({}));
      setErr({ id: r.catalogItemId, msg: d?.error ?? "No se pudo guardar." });
      return;
    }
    load();
  }

  if (rows.length === 0) return null;

  return (
    <div className="mb-6">
      <div className="text-[13.5px] font-bold mb-1">Escribe el Precio Dropi de estos productos ({rows.length})</div>
      <div className="rounded-md border border-gold/40 bg-gold/10 px-3 py-2 text-[12.5px] mb-3" style={{ color: "var(--color-gold)" }}>
        ⚠ Escribe el precio que está <b>PUBLICADO EN DROPI</b> (el que ves en la ficha del producto en Dropi). <b>No</b> uses el precio de INVESTOCK
        ni el de Stock Actual. Se escribe una sola vez por producto.
      </div>
      <div className="text-[12px] text-steel mb-3">
        Son productos que se venden en provedix.com y que DAFLOW no puede calcular solo (se compraron antes de DAFLOW). Sin este precio, los
        dropshippers no ven cuánto les cuesta ni cuánto ganan. Van en orden: primero los que más se venden.
      </div>
      <div className="flex flex-col gap-2">
        {rows.map((r) => (
          <div key={r.catalogItemId} className="bg-surface border border-rule rounded-md p-3 flex flex-wrap items-center gap-3">
            {r.photo && (
              // eslint-disable-next-line @next/next/no-img-element
              <img loading="lazy" decoding="async" src={r.photo} alt="" className="w-12 h-12 rounded object-cover shrink-0" />
            )}
            <div className="flex-1 min-w-[180px]">
              <div className="font-semibold text-[13px] leading-snug">{r.name}</div>
              <div className="text-[11.5px] text-steel font-mono">
                #{r.rank} · ID {r.code} · {r.unitsRange} unid./30 días
              </div>
              {err?.id === r.catalogItemId && <div className="text-red text-[12px] mt-1">{err.msg}</div>}
            </div>
            <div className="flex items-center gap-2">
              <label className="text-[11.5px] text-steel">Precio publicado en Dropi $</label>
              <input
                inputMode="decimal"
                value={values[r.catalogItemId] ?? ""}
                onChange={(e) => setValues((v) => ({ ...v, [r.catalogItemId]: e.target.value }))}
                placeholder="0.00"
                className="w-24 rounded border border-rule bg-bg px-2 py-1.5 text-[13px] tabular-nums"
              />
              <button
                type="button"
                disabled={busy === r.catalogItemId}
                onClick={() => save(r)}
                className="rounded border border-teal bg-teal px-3 py-1.5 text-[12px] font-bold text-navy cursor-pointer disabled:opacity-60"
              >
                {busy === r.catalogItemId ? "Guardando…" : "Guardar"}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
