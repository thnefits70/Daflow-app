"use client";

import { useEffect, useState } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";
import { CopyDropiPrice } from "@/components/shared/CopyDropiPrice";

type Change = { catalogItemId: string; name: string; code: string; photo: string | null; refPrice: number; newPrice: number; direction: "UP" | "DOWN" };

// Pedido del usuario 2026-10-02 — ver lib/dropiPriceChanges.ts. Productos
// ya publicados cuyo Precio Dropi conviene cambiar: subidas desde 2% (para
// mantener el 20%) y bajadas desde 3% (para competir).
export function DropiPriceChangesQueue() {
  const [rows, setRows] = useState<Change[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<{ id: string; msg: string } | null>(null);

  function load() {
    fetch("/api/market-products/dropi-price-changes").then((r) => (r.ok ? r.json() : [])).then(setRows).catch(() => setRows([]));
  }
  useEffect(load, []);

  async function confirm(c: Change) {
    setErr(null);
    setBusy(c.catalogItemId);
    const res = await fetch("/api/market-products/dropi-price-changes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ catalogItemId: c.catalogItemId, shownPrice: c.newPrice }),
    });
    setBusy(null);
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      setErr({ id: c.catalogItemId, msg: d.error ?? "No se pudo guardar." });
      load();
      return;
    }
    load();
  }

  if (rows.length === 0) return null;

  return (
    <div className="mb-6">
      <div className="text-[13.5px] font-bold mb-1">Cambió el precio mínimo en Dropi</div>
      <div className="text-[12px] text-steel mb-3">
        DAFLOW calcula el precio MÍNIMO (20% de ganancia) y cambió con las últimas compras. En Dropi pueden poner más según la competencia y el mercado, nunca menos que el mínimo.
      </div>
      <div className="flex flex-col gap-3">
        {rows.map((c) => {
          const up = c.direction === "UP";
          const pct = Math.abs((c.newPrice / c.refPrice - 1) * 100);
          return (
            <div key={c.catalogItemId} className={`bg-surface border rounded-md p-3.5 ${up ? "border-red" : "border-teal"}`}>
              <div className="flex items-start gap-3 mb-2">
                {c.photo && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={c.photo} alt="" className="w-14 h-14 rounded object-cover shrink-0" />
                )}
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-[13.5px]">{c.name}</div>
                  <div className="text-[12px] text-steel font-mono">ID {c.code}</div>
                  <div className={`text-[12.5px] font-semibold mt-1 flex items-center gap-1 ${up ? "text-red" : "text-teal"}`}>
                    {up ? <ArrowUp size={13} /> : <ArrowDown size={13} />}
                    El mínimo {up ? "SUBE" : "BAJA"}: de ${c.refPrice.toFixed(2)} a ${c.newPrice.toFixed(2)} ({up ? "+" : "−"}{pct.toFixed(1)}%)
                  </div>
                  <div className="text-[12px] text-steel mt-0.5">
                    {up
                      ? `Si en Dropi tienes menos de $${c.newPrice.toFixed(2)}, súbelo. Si ya tienes más, déjalo.`
                      : `Puedes bajar hasta $${c.newPrice.toFixed(2)} solo si la competencia lo pide. Si vendes bien con tu precio, déjalo.`}
                  </div>
                </div>
              </div>
              <CopyDropiPrice price={c.newPrice} label="Precio mínimo nuevo" />
              {err?.id === c.catalogItemId && <div className="text-red text-[12.5px] mb-2">{err.msg}</div>}
              <button
                type="button"
                disabled={busy === c.catalogItemId}
                className="rounded border border-teal bg-teal px-3.5 py-1.5 text-[12px] font-bold text-navy cursor-pointer disabled:opacity-60"
                onClick={() => confirm(c)}
              >
                {up ? `Listo: en Dropi tengo $${c.newPrice.toFixed(2)} o más` : "Revisado"}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
