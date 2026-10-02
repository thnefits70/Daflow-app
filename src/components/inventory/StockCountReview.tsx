"use client";

import { useEffect, useState } from "react";
import { ClipboardCheck } from "lucide-react";
import type { DifferenceRow } from "@/lib/stockCount";
import { areaLabel } from "@/lib/warehouseAreas";

type Pending = { id: string; kind: "FULL" | "WEEKLY_AREA"; area: string | null; weekStart: string | null; submittedAt: string; differences: DifferenceRow[] };

// Pedido del usuario 2026-10-02: el admin aprueba todas las diferencias del
// conteo físico en una sola lista (desmarca las que vea raras: esas no se
// ajustan). Aquí sí se ve lo que decía el sistema.
export function StockCountReview({ onApproved }: { onApproved?: () => void }) {
  const [rows, setRows] = useState<Pending[] | null>(null);
  const [unchecked, setUnchecked] = useState<Set<string>>(new Set());
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  function load() {
    fetch("/api/stock-count/review", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setRows(Array.isArray(d) ? d : null))
      .catch(() => setRows(null));
  }
  useEffect(load, []);

  async function approve(c: Pending) {
    setBusy(true);
    setErr("");
    const approveLineIds = c.differences.filter((d) => !unchecked.has(d.lineId)).map((d) => d.lineId);
    const res = await fetch(`/api/stock-count/${c.id}/approve`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ approveLineIds }) });
    const json = await res.json().catch(() => null);
    setBusy(false);
    setConfirming(null);
    if (!res.ok) return setErr(json?.error ?? "No se pudo aprobar.");
    setMsg(`Listo: ${json.applied} producto(s) ajustado(s)${json.rejected ? `, ${json.rejected} rechazado(s)` : ""}.`);
    load();
    onApproved?.();
  }

  if (!rows || (rows.length === 0 && !msg)) return null;
  return (
    <section className="border border-gold rounded-md p-3 mb-3">
      {msg && <div className="text-teal text-[12.5px] mb-2">{msg}</div>}
      {err && <div className="text-red text-[12.5px] mb-2">{err}</div>}
      {rows.map((c) => {
        const selected = c.differences.filter((d) => !unchecked.has(d.lineId));
        return (
          <div key={c.id} className="mb-3 last:mb-0">
            <div className="font-semibold text-[13px] flex items-center gap-2 mb-1 text-gold">
              <ClipboardCheck size={14} /> {c.kind === "FULL" ? "Conteo general" : `Conteo semanal · ${areaLabel(c.area)}`} por aprobar — {c.differences.length} diferencia(s)
            </div>
            <div className="text-[12px] text-steel mb-2">Desmarca lo que veas raro: eso no se ajusta. Lo marcado se corrige en el stock.</div>
            <div className="overflow-x-auto">
              <table className="text-[12.5px] min-w-[560px] w-full">
                <thead>
                  <tr className="text-left text-steel text-[11px] uppercase">
                    <th className="py-1 pr-2">
                      <input type="checkbox" checked={selected.length === c.differences.length} onChange={(e) => setUnchecked(e.target.checked ? new Set() : new Set(c.differences.map((d) => d.lineId)))} />
                    </th>
                    <th className="py-1 pr-2">Producto</th>
                    <th className="py-1 pr-2">Área</th>
                    <th className="py-1 pr-2 text-right">Sistema</th>
                    <th className="py-1 pr-2 text-right">Contado</th>
                    <th className="py-1 pr-2 text-right">Diferencia</th>
                    <th className="py-1">Contó</th>
                  </tr>
                </thead>
                <tbody>
                  {c.differences.map((d) => (
                    <tr key={d.lineId} className="border-t border-rule">
                      <td className="py-1 pr-2">
                        <input
                          type="checkbox"
                          checked={!unchecked.has(d.lineId)}
                          onChange={(e) =>
                            setUnchecked((s) => {
                              const n = new Set(s);
                              if (e.target.checked) n.delete(d.lineId);
                              else n.add(d.lineId);
                              return n;
                            })
                          }
                        />
                      </td>
                      <td className="py-1 pr-2">{d.name} <span className="text-steel font-mono text-[11px]">{d.justCode ?? ""}</span></td>
                      <td className="py-1 pr-2">{d.area ?? "—"}</td>
                      <td className="py-1 pr-2 text-right font-mono">{d.expectedQty}</td>
                      <td className="py-1 pr-2 text-right font-mono">{d.countedQty}</td>
                      <td className={`py-1 pr-2 text-right font-mono font-bold ${d.diff < 0 ? "text-red" : "text-teal"}`}>{d.diff > 0 ? `+${d.diff}` : d.diff}</td>
                      <td className="py-1 text-steel">{d.countedByName ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {confirming === c.id ? (
              <div className="mt-2 bg-cloud border border-gold/50 rounded p-2 text-[12.5px]">
                ¿Aprobar {selected.length} ajuste(s){c.differences.length - selected.length > 0 ? ` y rechazar ${c.differences.length - selected.length}` : ""}? El stock queda como se contó y no se puede deshacer.
                <div className="flex gap-2 mt-1.5">
                  <button type="button" disabled={busy} className="rounded border border-gold bg-gold px-3 py-1 font-bold text-navy cursor-pointer" onClick={() => approve(c)}>{busy ? "Aprobando…" : "Sí, aprobar"}</button>
                  <button type="button" className="text-steel cursor-pointer" onClick={() => setConfirming(null)}>Cancelar</button>
                </div>
              </div>
            ) : (
              <button type="button" className="mt-2 rounded border border-teal bg-teal px-3 py-1.5 text-[12.5px] font-bold text-navy cursor-pointer" onClick={() => setConfirming(c.id)}>
                Aprobar lo marcado ({selected.length})
              </button>
            )}
          </div>
        );
      })}
    </section>
  );
}
