"use client";

import { useEffect, useState } from "react";
import { Check, X } from "lucide-react";

type Tier = { id: string; name: string; orderIndex: number; minDailyAvg: number; maxDailyAvg: number | null };
type EmployeeTierAmount = { tierId: string; tierName: string; amount: number; pendingAmount: number | null; proposedByName: string | null };
type Employee = { id: string; name: string; position: string | null; department: { name: string } | null; tiers: EmployeeTierAmount[] };
type Progress = { month: string; dailyAvg: number | null; from: string | null; to: string | null; tiers: Tier[] };

const TIER_EMOJI: Record<string, string> = { "Raíz": "🌱", "Cosecha": "🌾" };

function money(n: number) {
  return `$${n.toFixed(2)}`;
}

const MONTH_ABBR = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
function fmtMonth(month: string) {
  const [y, m] = month.split("-");
  return `${MONTH_ABBR[Number(m) - 1]} ${y.slice(2)}`;
}

function fmtRange(from: string, to: string) {
  const f = new Date(`${from}T00:00:00Z`);
  const t = new Date(`${to}T00:00:00Z`);
  const fmt = (d: Date) => d.toLocaleDateString("es-EC", { day: "numeric", month: "short", timeZone: "UTC" });
  return `${fmt(f)} – ${fmt(t)}`;
}

// Confirmado 2026-08-14: muestra el ÚLTIMO MES COMPLETO (nunca el mes en
// curso), mismo criterio que el widget público de Inicio — evita que este
// número se vea descuadrado contra otros indicadores de una sola semana.
function ProgressWidget() {
  const [progress, setProgress] = useState<Progress | null>(null);
  useEffect(() => {
    fetch("/api/commissions/progress").then((r) => (r.ok ? r.json() : null)).then(setProgress);
  }, []);
  if (!progress) return null;

  return (
    <div className="bg-surface border border-rule rounded-md p-4 mb-4">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-steel mb-2">Progreso — {fmtMonth(progress.month)} (último mes completo)</div>
      <div className="text-[13px] mb-2.5">
        {progress.dailyAvg !== null ? (
          <>
            Promedio diario: <span className="font-bold tabular-nums">{progress.dailyAvg.toFixed(0)}</span> pedidos/día
            {progress.from && progress.to && <span className="text-steel-dim"> — {fmtRange(progress.from, progress.to)} (lunes a sábado, sin domingos)</span>}
          </>
        ) : (
          <>Todavía no hay datos de Pedidos despachados de {fmtMonth(progress.month)}.</>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        {progress.tiers.map((t) => {
          const achieved = progress.dailyAvg !== null && progress.dailyAvg >= t.minDailyAvg;
          const isProvedix = t.name === "PROVEDIX";
          return (
            <div
              key={t.id}
              className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11.5px] font-semibold border ${
                achieved ? "border-teal bg-teal/10 text-teal" : "border-rule text-steel"
              } ${achieved && isProvedix ? "shadow-[0_0_10px_rgba(20,199,199,0.5)]" : ""}`}
            >
              {TIER_EMOJI[t.name] && <span>{TIER_EMOJI[t.name]}</span>}
              <span className={isProvedix ? "font-extrabold" : ""}>{t.name}</span>
              <span className="text-steel-dim font-normal">{t.minDailyAvg}-{t.maxDailyAvg ?? "+"}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TierCell({ tierId, cell, employeeId, canPropose, canApprove, onSaved }: { tierId: string; cell: EmployeeTierAmount; employeeId: string; canPropose: boolean; canApprove: boolean; onSaved: () => void }) {
  const [value, setValue] = useState(String(cell.pendingAmount ?? cell.amount));
  const [busy, setBusy] = useState(false);
  const hasPending = cell.pendingAmount !== null;

  async function propose() {
    const n = Number(value);
    if (!n || n < 0) return;
    if (n === cell.amount && !hasPending) return;
    setBusy(true);
    await fetch(`/api/commissions/amounts/${tierId}/${employeeId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pendingAmount: n }),
    });
    setBusy(false);
    onSaved();
  }

  async function resolve(action: "approve" | "reject") {
    setBusy(true);
    await fetch(`/api/commissions/amounts/${tierId}/${employeeId}/${action}`, { method: "POST" });
    setBusy(false);
    onSaved();
  }

  return (
    <td className="py-2 pr-3">
      <input
        className={`rounded border px-2 py-1 text-[12px] w-20 disabled:opacity-70 ${hasPending ? "border-gold bg-gold/10" : "border-rule bg-cloud"}`}
        type="number"
        step="0.01"
        disabled={!canPropose || busy}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={propose}
      />
      {hasPending && (
        <div className="mt-1 text-[10px]">
          <div style={{ color: "#D9A441" }} className="font-semibold">Esperando aprobación (vigente: {money(cell.amount)})</div>
          {canApprove && (
            <div className="flex items-center gap-2 mt-0.5">
              <button type="button" disabled={busy} className="flex items-center gap-0.5 text-green font-semibold cursor-pointer" onClick={() => resolve("approve")}>
                <Check size={11} /> Aprobar
              </button>
              <button type="button" disabled={busy} className="flex items-center gap-0.5 text-red font-semibold cursor-pointer" onClick={() => resolve("reject")}>
                <X size={11} /> Rechazar
              </button>
            </div>
          )}
        </div>
      )}
    </td>
  );
}

// Confirmado 2026-08-14: diseñado en conversación larga con el usuario —
// Nairoby propone el monto que cobra cada persona por nivel, pero queda
// inactivo (pendingAmount) hasta que el admin lo aprueba, para evitar que
// ella infle un valor. Ambos ven la misma tabla; solo el admin ve los
// botones Aprobar/Rechazar.
export function CommissionTiersPanel({ canPropose, canApprove }: { canPropose: boolean; canApprove: boolean }) {
  const [data, setData] = useState<{ tiers: Tier[]; employees: Employee[] } | null>(null);

  function load() {
    fetch("/api/commissions/amounts").then((r) => (r.ok ? r.json() : null)).then(setData);
  }
  useEffect(load, []);

  return (
    <div>
      <ProgressWidget />
      {!data ? (
        <div className="text-steel text-[13px]">Cargando…</div>
      ) : (
        <div className="bg-surface border border-rule rounded-md p-4">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-steel mb-3">Comisión por persona y nivel</div>
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="text-[10px] font-semibold uppercase tracking-wide text-steel border-b border-rule">
                  <th className="pb-1.5 pr-3">Colaborador</th>
                  {data.tiers.map((t) => (
                    <th key={t.id} className="pb-1.5 pr-3">{t.name}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.employees.map((e) => (
                  <tr key={e.id} className="border-b border-rule last:border-0 align-top">
                    <td className="py-2 pr-3">
                      <div className="font-semibold text-[12.5px]">{e.name}</div>
                      <div className="text-[10.5px] text-steel">
                        {e.department?.name ?? "—"}
                        {e.position ? ` · ${e.position}` : ""}
                      </div>
                    </td>
                    {e.tiers.map((cell) => (
                      <TierCell key={cell.tierId} tierId={cell.tierId} cell={cell} employeeId={e.id} canPropose={canPropose} canApprove={canApprove} onSaved={load} />
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!canPropose && <div className="text-[10.5px] text-steel-dim mt-2">Solo lectura.</div>}
        </div>
      )}
    </div>
  );
}
