"use client";

import { useEffect, useState } from "react";
import { Gift } from "lucide-react";

type Employee = { id: string; name: string; department: { name: string } | null };
type Grant = { id: string; type: "ADICIONAL" | "PRODUCTIVIDAD" | "MERITO"; note: string | null; grantedAt: string; user: { name: string } };

const BONUS_TYPES: { type: Grant["type"]; label: string; amount: number }[] = [
  { type: "ADICIONAL", label: "Bono Adicional", amount: 50 },
  { type: "PRODUCTIVIDAD", label: "Bono de Productividad", amount: 100 },
  { type: "MERITO", label: "Bono al Mérito", amount: 150 },
];

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("es-EC", { day: "numeric", month: "short", year: "numeric" });
}

// Confirmado 2026-08-14: exclusivo del CEO — elige persona + tipo fijo +
// nota opcional, y al otorgarlo ya queda aprobado (dispara pop-up +
// historial privado + push al destinatario, todo automático desde la ruta).
export function CeoBonusesPanel() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [grants, setGrants] = useState<Grant[]>([]);
  const [userId, setUserId] = useState("");
  const [type, setType] = useState<Grant["type"]>("ADICIONAL");
  const [note, setNote] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState("");

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
    await fetch("/api/ceo-bonuses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, type, note: note.trim() || undefined }),
    });
    setBusy(false);
    setConfirming(false);
    setNote("");
    setToast("✓ Bono otorgado");
    setTimeout(() => setToast(""), 2500);
    load();
  }

  const selected = BONUS_TYPES.find((b) => b.type === type)!;

  return (
    <div>
      <div className="bg-surface border border-rule rounded-md p-4 mb-4">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-steel mb-3">Otorgar bono discrecional</div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 mb-3">
          {BONUS_TYPES.map((b) => (
            <button
              key={b.type}
              type="button"
              className={`rounded-md border-[1.5px] p-3 text-left cursor-pointer ${type === b.type ? "border-teal bg-teal/10" : "border-rule"}`}
              onClick={() => setType(b.type)}
            >
              <div className="flex items-center gap-1.5 font-bold text-[13px]">
                <Gift size={14} className={type === b.type ? "text-teal" : "text-steel"} /> {b.label}
              </div>
              <div className="text-[12px] text-steel mt-0.5">${b.amount}</div>
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

        {!confirming ? (
          <button type="button" disabled={!userId} className="text-[12.5px] font-bold bg-teal text-navy rounded-md px-4 py-2 cursor-pointer disabled:opacity-50" onClick={() => setConfirming(true)}>
            Otorgar {selected.label} (${selected.amount})
          </button>
        ) : (
          <div className="max-w-md border-[1.5px] border-teal rounded-md bg-cloud p-3.5">
            <div className="text-[13px] font-bold mb-3">
              ¿Confirmás otorgar {selected.label} (${selected.amount}) a {employees.find((e) => e.id === userId)?.name}?
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
                {g.note && <span className="text-steel"> · {g.note}</span>}
              </div>
              <span className="text-steel-dim text-[11px] shrink-0">{fmtDate(g.grantedAt)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
