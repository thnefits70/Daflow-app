"use client";

import { useEffect, useState } from "react";
import { Wrench } from "lucide-react";

type Row = { catalogItemId: string; name: string; code: string | null; balance: number; kardexAvg: number; correctAvg: number };

// Pedido del usuario (CEO) 2026-10-02: unidades que entraron a $0
// (devoluciones antes de la primera compra) bajaron el costo promedio del
// Kardex de algunos productos. Solo admin: ve cuáles, de cuánto a cuánto, y
// los corrige con una línea de corrección en el Kardex (no se borra nada).
export function ZeroCostCorrectionCard({ onApplied }: { onApplied: () => void }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  function load() {
    fetch("/api/inventory-control/zero-cost-corrections").then((r) => (r.ok ? r.json() : [])).then(setRows).catch(() => setRows([]));
  }
  useEffect(load, []);

  async function apply() {
    if (!rows) return;
    setBusy(true);
    setMsg("");
    const res = await fetch("/api/inventory-control/zero-cost-corrections", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rows: rows.map((r) => ({ catalogItemId: r.catalogItemId, balance: r.balance, kardexAvg: r.kardexAvg })) }),
    });
    setBusy(false);
    setConfirming(false);
    const d = await res.json().catch(() => ({}));
    if (!res.ok) {
      setMsg(d.error ?? "No se pudo corregir.");
      return;
    }
    setMsg(`Listo: ${d.corrected} producto${d.corrected === 1 ? "" : "s"} corregido${d.corrected === 1 ? "" : "s"}${d.skipped ? ` · ${d.skipped} cambiaron mientras tanto, revisa de nuevo` : ""}.`);
    load();
    onApplied();
  }

  if (!rows || (rows.length === 0 && !msg)) return null;
  const total = rows.reduce((s, r) => s + r.balance * (r.correctAvg - r.kardexAvg), 0);

  return (
    <div className="border border-gold rounded-md mb-3 p-3">
      <div className="flex items-center gap-2 text-[13px] font-bold text-gold mb-1">
        <Wrench size={14} /> Corregir costo del Kardex (unidades que entraron a $0)
      </div>
      {rows.length > 0 && (
        <>
          <div className="text-[12px] text-steel mb-2">
            Estas unidades entraron sin costo (devoluciones antes de la primera compra) y bajaron el costo promedio. El costo correcto sale de las compras reales. Se agrega una línea de corrección en el Kardex; no se borra nada.
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="text-steel text-left">
                  <th className="py-1 pr-2">Producto</th>
                  <th className="py-1 pr-2 text-right">Stock</th>
                  <th className="py-1 pr-2 text-right">Costo hoy</th>
                  <th className="py-1 pr-2 text-right">Correcto</th>
                  <th className="py-1 text-right">Diferencia</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.catalogItemId} className="border-t border-rule">
                    <td className="py-1 pr-2">
                      {r.name} <span className="text-steel font-mono text-[11px]">{r.code ?? ""}</span>
                    </td>
                    <td className="py-1 pr-2 text-right">{r.balance}</td>
                    <td className="py-1 pr-2 text-right">${r.kardexAvg.toFixed(2)}</td>
                    <td className="py-1 pr-2 text-right font-semibold">${r.correctAvg.toFixed(2)}</td>
                    <td className="py-1 text-right">+${(r.balance * (r.correctAvg - r.kardexAvg)).toFixed(2)}</td>
                  </tr>
                ))}
                <tr className="border-t border-rule font-bold">
                  <td className="py-1 pr-2" colSpan={4}>Total (el inventario vale esto más de lo que dice el Kardex)</td>
                  <td className="py-1 text-right">+${total.toFixed(2)}</td>
                </tr>
              </tbody>
            </table>
          </div>
          {confirming ? (
            <div className="bg-inset rounded-md p-3 mt-2">
              <div className="text-[13px] font-bold mb-1">¿Seguro?</div>
              <div className="text-[12px] text-steel mb-2">
                Se corrige el costo del Kardex de {rows.length} producto{rows.length === 1 ? "" : "s"} y el valor del inventario sube ${total.toFixed(2)}.
              </div>
              <div className="flex items-center gap-2">
                <button type="button" disabled={busy} className="rounded border border-teal bg-teal px-3.5 py-1.5 text-[12px] font-bold text-navy cursor-pointer disabled:opacity-60" onClick={apply}>
                  {busy ? "Corrigiendo…" : "Sí, corregir"}
                </button>
                <button type="button" className="text-steel text-[12px] cursor-pointer" onClick={() => setConfirming(false)}>
                  Cancelar
                </button>
              </div>
            </div>
          ) : (
            <button type="button" className="mt-2 rounded border border-gold px-3.5 py-1.5 text-[12px] font-bold text-gold cursor-pointer" onClick={() => setConfirming(true)}>
              Corregir {rows.length} producto{rows.length === 1 ? "" : "s"}
            </button>
          )}
        </>
      )}
      {msg && <div className="text-[12.5px] text-teal mt-2">{msg}</div>}
    </div>
  );
}
