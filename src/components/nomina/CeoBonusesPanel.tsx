"use client";

import { useEffect, useState } from "react";
import { Gift } from "lucide-react";
import { formatDateTime } from "@/lib/formatDateTime";

type BonusType = "ADICIONAL" | "PRODUCTIVIDAD" | "MERITO" | "PERSONALIZADO";
type Employee = { id: string; name: string; department: { name: string } | null };
type Grant = { id: string; type: BonusType; note: string | null; grantedAt: string; amount: number | null; targetPeriod: string | null; user: { name: string } };

const BONUS_TYPES: { type: BonusType; label: string; amount: number | null }[] = [
  { type: "ADICIONAL", label: "Bono Adicional", amount: 50 },
  { type: "PRODUCTIVIDAD", label: "Bono de Productividad", amount: 100 },
  { type: "MERITO", label: "Bono al Mérito", amount: 150 },
  { type: "PERSONALIZADO", label: "Bono personalizado", amount: null },
];

// Quincenas candidatas para el bono personalizado: mes actual + próximos 5,
// Q1 y Q2 de cada uno. El servidor rechaza igual si esa quincena ya fue
// generada (ese rol ya no se recalcula solo).
function nextPeriods(monthsCount: number): string[] {
  const now = new Date();
  const out: string[] = [];
  for (let i = 0; i < monthsCount; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    const m = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    out.push(`${m}-Q1`, `${m}-Q2`);
  }
  return out;
}

// Confirmado 2026-08-14: exclusivo del CEO — elige persona + tipo fijo +
// nota opcional, y al otorgarlo ya queda aprobado (dispara pop-up +
// historial privado + push al destinatario, todo automático desde la ruta).
export function CeoBonusesPanel() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [grants, setGrants] = useState<Grant[]>([]);
  const [userId, setUserId] = useState("");
  const [type, setType] = useState<BonusType>("ADICIONAL");
  const [note, setNote] = useState("");
  const [customAmount, setCustomAmount] = useState("");
  const [targetPeriod, setTargetPeriod] = useState(nextPeriods(1)[0]);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState("");
  const [err, setErr] = useState("");

  function load() {
    fetch("/api/payroll/employees").then((r) => (r.ok ? r.json() : [])).then((rows) => {
      setEmployees(rows);
      if (rows[0]) setUserId((id: string) => id || rows[0].id);
    });
    fetch("/api/ceo-bonuses").then((r) => (r.ok ? r.json() : [])).then(setGrants);
  }
  useEffect(load, []);

  async function grant() {
    if (!userId) return;
    setBusy(true);
    setErr("");
    const res = await fetch("/api/ceo-bonuses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId,
        type,
        note: note.trim() || undefined,
        amount: type === "PERSONALIZADO" ? Number(customAmount) : undefined,
        targetPeriod: type === "PERSONALIZADO" ? targetPeriod : undefined,
      }),
    });
    setBusy(false);
    const data = await res.json().catch(() => null);
    if (!res.ok) { setErr(data?.error ?? "No se pudo otorgar."); setConfirming(false); return; }
    setConfirming(false);
    setNote("");
    setCustomAmount("");
    setToast("✓ Bono otorgado");
    setTimeout(() => setToast(""), 2500);
    load();
  }

  const selected = BONUS_TYPES.find((b) => b.type === type)!;
  const isCustom = type === "PERSONALIZADO";
  const customAmountValid = isCustom ? Number(customAmount) > 0 : true;
  const displayAmount = isCustom ? (Number(customAmount) || 0) : (selected.amount ?? 0);

  return (
    <div>
      <div className="bg-surface border border-rule rounded-md p-4 mb-4">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-steel mb-3">Otorgar bono discrecional</div>

        <div className="grid grid-cols-1 sm:grid-cols-4 gap-2.5 mb-3">
          {BONUS_TYPES.map((b) => (
            <button
              key={b.type}
              type="button"
              className={`rounded-md border-[1.5px] p-3 text-left cursor-pointer ${type === b.type ? "border-teal bg-teal/10" : "border-rule"}`}
              onClick={() => { setType(b.type); setConfirming(false); setErr(""); }}
            >
              <div className="flex items-center gap-1.5 font-bold text-[13px]">
                <Gift size={14} className={type === b.type ? "text-teal" : "text-steel"} /> {b.label}
              </div>
              <div className="text-[12px] text-steel mt-0.5">{b.amount !== null ? `$${b.amount}` : "Monto a elegir"}</div>
            </button>
          ))}
        </div>

        <div className="flex items-end gap-3 flex-wrap mb-3">
          <div>
            <label className="block mb-1 text-[10px] font-semibold uppercase tracking-wide text-steel">Colaborador</label>
            <select className="rounded border border-rule bg-cloud px-2.5 py-2 text-[13px]" value={userId} onChange={(e) => setUserId(e.target.value)}>
              {employees.map((e) => (
                <option key={e.id} value={e.id}>{e.name}{e.department ? ` — ${e.department.name}` : ""}</option>
              ))}
            </select>
          </div>
          {isCustom && (
            <>
              <div>
                <label className="block mb-1 text-[10px] font-semibold uppercase tracking-wide text-steel">Monto</label>
                <input
                  className="rounded border border-rule bg-cloud px-2.5 py-2 text-[13px] w-28"
                  type="number"
                  step="0.01"
                  placeholder="0.00"
                  value={customAmount}
                  onChange={(e) => { setCustomAmount(e.target.value); setConfirming(false); setErr(""); }}
                />
              </div>
              <div>
                <label className="block mb-1 text-[10px] font-semibold uppercase tracking-wide text-steel">Quincena en que se paga</label>
                <select className="rounded border border-rule bg-cloud px-2.5 py-2 text-[13px]" value={targetPeriod} onChange={(e) => { setTargetPeriod(e.target.value); setConfirming(false); setErr(""); }}>
                  {nextPeriods(6).map((p) => (<option key={p} value={p}>{p}</option>))}
                </select>
              </div>
            </>
          )}
          <div className="flex-1 min-w-[220px]">
            <label className="block mb-1 text-[10px] font-semibold uppercase tracking-wide text-steel">Nota (opcional — no confidencial más allá del destinatario)</label>
            <input
              className="w-full rounded border border-rule bg-cloud px-2.5 py-2 text-[13px]"
              placeholder="Motivo breve"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
        </div>

        {err && <div className="text-red text-[12.5px] mb-2">{err}</div>}

        {!confirming ? (
          <button type="button" disabled={!userId || !customAmountValid} className="text-[12.5px] font-bold bg-teal text-navy rounded-md px-4 py-2 cursor-pointer disabled:opacity-50" onClick={() => setConfirming(true)}>
            Otorgar {selected.label} (${displayAmount.toFixed(2)})
          </button>
        ) : (
          <div className="max-w-md border-[1.5px] border-teal rounded-md bg-cloud p-3.5">
            <div className="text-[13px] font-bold mb-3">
              ¿Confirmás otorgar {selected.label} (${displayAmount.toFixed(2)}) a {employees.find((e) => e.id === userId)?.name}{isCustom ? `, pagadero en la quincena ${targetPeriod}` : ""}?
            </div>
            <div className="flex gap-2">
              <button type="button" className="text-[12px] font-semibold border border-rule rounded px-3 py-1.5 cursor-pointer" onClick={() => setConfirming(false)}>
                Cancelar
              </button>
              <button type="button" disabled={busy} className="text-[12px] font-bold bg-teal text-navy rounded px-3 py-1.5 cursor-pointer disabled:opacity-60" onClick={grant}>
                {busy ? "Otorgando…" : "Sí, otorgar"}
              </button>
            </div>
          </div>
        )}
        {toast && <div className="text-teal text-[12px] font-semibold mt-2">{toast}</div>}
      </div>

      <div className="bg-surface border border-rule rounded-md p-4">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-steel mb-2">Historial otorgado</div>
        {grants.length === 0 && <div className="text-steel text-[12.5px]">Todavía no se otorgó ningún bono.</div>}
        <div className="flex flex-col">
          {grants.map((g) => (
            <div key={g.id} className="flex items-center justify-between gap-2 py-2 border-b border-rule last:border-0 text-[12.5px]">
              <div>
                <span className="font-semibold">{g.user.name}</span> — {BONUS_TYPES.find((b) => b.type === g.type)?.label}
                {g.type === "PERSONALIZADO" && <span className="text-steel"> (${(g.amount ?? 0).toFixed(2)} — {g.targetPeriod})</span>}
                {g.note && <span className="text-steel"> · {g.note}</span>}
              </div>
              <span className="text-steel-dim text-[11px] shrink-0">{formatDateTime(g.grantedAt)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
