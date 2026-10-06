"use client";

import { useEffect, useState } from "react";
import { ClipboardCheck } from "lucide-react";
import type { DifferenceRow } from "@/lib/stockCount";
import { areaLabel } from "@/lib/warehouseAreas";

type Pending = { id: string; kind: "FULL" | "WEEKLY_AREA"; area: string | null; weekStart: string | null; submittedAt: string; differences: DifferenceRow[] };

// Pedido del usuario 2026-10-02: el admin aprueba todas las diferencias del
// conteo físico en una sola lista. Aquí sí se ve lo que decía el sistema.
// Desde 2026-10-05 lo desmarcado lo vuelve a contar OTRA persona (Daniel lo
// asigna), salvo que el admin elija "dejar como está".
export function StockCountReview({ onApproved }: { onApproved?: () => void }) {
  const [rows, setRows] = useState<Pending[] | null>(null);
  const [unchecked, setUnchecked] = useState<Set<string>>(new Set());
  const [keep, setKeep] = useState<Set<string>>(new Set());
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
    const keepLineIds = c.differences.filter((d) => unchecked.has(d.lineId) && keep.has(d.lineId)).map((d) => d.lineId);
    const res = await fetch(`/api/stock-count/${c.id}/approve`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ approveLineIds, keepLineIds }) });
    const json = await res.json().catch(() => null);
    setBusy(false);
    setConfirming(null);
    if (!res.ok) return setErr(json?.error ?? "No se pudo aprobar.");
    setMsg(`Listo: ${json.applied} producto(s) ajustado(s)${json.recount ? `, ${json.recount} van a recuento con otra persona` : ""}${json.rejected ? `, ${json.rejected} se dejaron como estaban` : ""}.`);
    load();
    onApproved?.();
  }

  if (!rows || (!rows.some((c) => c.differences.length > 0) && !msg)) return null;
  return (
    <section className="border border-gold rounded-md p-3 mb-3">
      {msg && <div className="text-teal text-[12.5px] mb-2">{msg}</div>}
      {err && <div className="text-red text-[12.5px] mb-2">{err}</div>}
      {rows.filter((c) => c.differences.length > 0).map((c) => {
        const selected = c.differences.filter((d) => !unchecked.has(d.lineId));
        const toKeep = c.differences.filter((d) => unchecked.has(d.lineId) && keep.has(d.lineId)).length;
        const toRecount = c.differences.length - selected.length - toKeep;
        return (
          <div key={c.id} className="mb-3 last:mb-0">
            <div className="font-semibold text-[13px] flex items-center gap-2 mb-1 text-gold">
              <ClipboardCheck size={14} /> {c.kind === "FULL" ? "Conteo general" : `Conteo semanal · ${areaLabel(c.area)}`} por aprobar — {c.differences.length} diferencia(s)
            </div>
            <div className="text-[12px] text-steel mb-2">Lo marcado se corrige en el stock. Desmarca lo que veas raro: lo vuelve a contar otra persona y te regresa a esta lista.</div>
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
                      <td className="py-1 pr-2">
                        {d.name} <span className="text-steel font-mono text-[11px]">{d.justCode ?? ""}</span>
                        {d.variantCounts && d.variantCounts.length > 0 && (
                          <div className="text-steel text-[11px]">{d.variantCounts.map((v) => `${v.name} ${v.qty}`).join(" · ")}</div>
                        )}
                      </td>
                      <td className="py-1 pr-2">{d.area ?? "—"}</td>
                      <td className="py-1 pr-2 text-right font-mono">{d.expectedQty}</td>
                      <td className="py-1 pr-2 text-right font-mono">{d.countedQty}</td>
                      <td className={`py-1 pr-2 text-right font-mono font-bold ${d.diff < 0 ? "text-red" : "text-teal"}`}>{d.diff > 0 ? `+${d.diff}` : d.diff}</td>
                      <td className="py-1 text-steel">
                        {d.countedByName ?? "—"}
                        {unchecked.has(d.lineId) && (
                          <button
                            type="button"
                            className="block text-[11px] underline cursor-pointer text-gold"
                            onClick={() =>
                              setKeep((s) => {
                                const n = new Set(s);
                                if (n.has(d.lineId)) n.delete(d.lineId);
                                else n.add(d.lineId);
                                return n;
                              })
                            }
                          >
                            {keep.has(d.lineId) ? "Se deja como está (cambiar a recontar)" : "Va a recuento (o dejar como está)"}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {confirming === c.id ? (
              <div className="mt-2 bg-cloud border border-gold/50 rounded p-2 text-[12.5px]">
                ¿Aprobar {selected.length} ajuste(s){toRecount > 0 ? `, mandar ${toRecount} a recuento` : ""}{toKeep > 0 ? ` y dejar ${toKeep} como están` : ""}? Lo aprobado queda como se contó y no se puede deshacer.
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
