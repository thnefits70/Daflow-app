"use client";

import { useEffect, useState } from "react";

type Pending = {
  id: string;
  employee: { id: string; name: string; department: { name: string } | null };
  date: string;
  minutesExtra: number;
  enteredByName: string | null;
};

type Employee = { id: string; name: string; department: { name: string } | null };

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("es-EC", { weekday: "short", day: "numeric", month: "short" });
}
function fmtMinutes(min: number) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h === 0) return `${m}min`;
  return m === 0 ? `${h}h` : `${h}h ${m}min`;
}

function RejectButton({ onConfirm, busy }: { onConfirm: () => void; busy: boolean }) {
  const [asking, setAsking] = useState(false);
  if (asking) {
    return (
      <div className="flex items-center gap-2 bg-red/10 border border-red/35 rounded-md px-2.5 py-1.5">
        <span className="text-[11.5px] text-red">¿Rechazar?</span>
        <button type="button" disabled={busy} className="text-[11.5px] font-bold text-red cursor-pointer disabled:opacity-60" onClick={onConfirm}>Sí</button>
        <button type="button" className="text-[11.5px] text-steel cursor-pointer" onClick={() => setAsking(false)}>No</button>
      </div>
    );
  }
  return (
    <button
      type="button"
      className="text-[12px] font-bold border-[1.5px] border-red text-red bg-transparent rounded-md px-3.5 py-1.5 cursor-pointer"
      onClick={() => setAsking(true)}
    >
      Rechazar
    </button>
  );
}

// Confirmado 2026-08-13: sin tu aprobación, ese día no cuenta para nada del
// cálculo mensual — exclusivo del admin. Ampliado 2026-08-17: el admin
// también puede rechazar (borra el pendiente, nunca contó) o cargar horas
// extra manualmente para cualquier colaborador — esa carga manual queda
// aprobada de una vez porque la está haciendo el propio admin.
export function OvertimeApprovalPanel() {
  const [pending, setPending] = useState<Pending[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [employees, setEmployees] = useState<Employee[] | null>(null);
  const [showManual, setShowManual] = useState(false);
  const [manualEmployeeId, setManualEmployeeId] = useState("");
  const [manualDate, setManualDate] = useState("");
  const [manualMinutes, setManualMinutes] = useState(60);
  const [manualBusy, setManualBusy] = useState(false);
  const [manualErr, setManualErr] = useState("");

  function load() {
    fetch("/api/payroll/overtime/pending").then((r) => (r.ok ? r.json() : [])).then(setPending);
  }
  useEffect(load, []);

  useEffect(() => {
    const nowLocal = new Date();
    setManualDate(`${nowLocal.getFullYear()}-${String(nowLocal.getMonth() + 1).padStart(2, "0")}-${String(nowLocal.getDate()).padStart(2, "0")}`);
  }, []);

  function loadEmployees() {
    if (employees) return;
    fetch("/api/payroll/employees").then((r) => (r.ok ? r.json() : [])).then((list: Employee[]) => {
      setEmployees(list);
      if (list[0]) setManualEmployeeId(list[0].id);
    });
  }

  async function approve(id: string) {
    setBusyId(id);
    await fetch(`/api/payroll/overtime/${id}/approve`, { method: "POST" });
    setBusyId(null);
    load();
  }

  async function reject(id: string) {
    setBusyId(id);
    await fetch(`/api/payroll/overtime/${id}/reject`, { method: "POST" });
    setBusyId(null);
    load();
  }

  async function sendManual() {
    setManualBusy(true);
    setManualErr("");
    const res = await fetch("/api/payroll/overtime/manual", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ employeeId: manualEmployeeId, date: manualDate, minutesExtra: manualMinutes }),
    });
    setManualBusy(false);
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      setManualErr(data?.error ?? "No se pudo cargar.");
      return;
    }
    setManualMinutes(60);
    setShowManual(false);
    load();
  }

  if (!pending) return <div className="text-steel text-[13px]">Cargando…</div>;

  return (
    <div>
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-steel">
          Horas extra pendientes de aprobar ({pending.length})
        </div>
        <button
          type="button"
          className="text-[12px] font-semibold text-teal border-[1.5px] border-teal rounded-md px-3 py-1.5 cursor-pointer"
          onClick={() => { setShowManual((v) => !v); if (!showManual) loadEmployees(); }}
        >
          {showManual ? "Cancelar" : "+ Ingresar horas extra manual"}
        </button>
      </div>

      {showManual && (
        <div className="bg-surface border border-rule rounded-md p-4 mb-4">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-steel mb-3">Carga manual — queda aprobada de una vez</div>
          {!employees ? (
            <div className="text-steel text-[13px]">Cargando colaboradores…</div>
          ) : (
            <div className="flex items-end gap-3 flex-wrap">
              <div>
                <label className="block mb-1 text-[10px] font-semibold uppercase tracking-wide text-steel">Colaborador</label>
                <select className="rounded border border-rule bg-cloud px-2.5 py-2 text-[13px]" value={manualEmployeeId} onChange={(e) => setManualEmployeeId(e.target.value)}>
                  {employees.map((e) => (
                    <option key={e.id} value={e.id}>{e.name} · {e.department?.name ?? "—"}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block mb-1 text-[10px] font-semibold uppercase tracking-wide text-steel">Fecha</label>
                <input
                  type="date"
                  className="rounded border border-rule bg-cloud px-2.5 py-2 text-[13px]"
                  value={manualDate}
                  max={manualDate}
                  onChange={(e) => setManualDate(e.target.value)}
                />
              </div>
              <div>
                <label className="block mb-1 text-[10px] font-semibold uppercase tracking-wide text-steel">Minutos extra</label>
                <input
                  type="number"
                  min={1}
                  max={600}
                  className="rounded border border-rule bg-cloud px-2.5 py-2 text-[13px] w-24"
                  value={manualMinutes}
                  onChange={(e) => setManualMinutes(Number(e.target.value))}
                />
              </div>
              <div className="text-[13px] font-bold text-ink">{fmtMinutes(manualMinutes)}</div>
              <button
                type="button"
                disabled={manualBusy || !manualEmployeeId || manualMinutes <= 0}
                className="text-[12.5px] font-bold rounded-md px-4 py-2 bg-blue text-white cursor-pointer disabled:opacity-40"
                onClick={sendManual}
              >
                {manualBusy ? "Cargando…" : "Cargar y aprobar"}
              </button>
            </div>
          )}
          {manualErr && <div className="text-red text-[12px] mt-2">{manualErr}</div>}
        </div>
      )}

      {pending.length === 0 && (
        <div className="border-[1.5px] border-dashed border-rule rounded-md p-8 text-center text-steel text-[13px]">
          Nada pendiente por ahora.
        </div>
      )}
      <div className="flex flex-col gap-2">
        {pending.map((p) => (
          <div key={p.id} className="bg-surface border border-rule rounded-md p-3.5 flex items-center gap-3 flex-wrap">
            <span className="font-semibold text-[13px] min-w-[110px]">{fmtDate(p.date)}</span>
            <span className="text-[12.5px] text-ink">{fmtMinutes(p.minutesExtra)} extra</span>
            <span className="text-[12px] text-steel">{p.employee.name} · {p.employee.department?.name ?? "—"}</span>
            <span className="text-[10.5px] text-steel-dim">cargado por {p.enteredByName ?? "—"}</span>
            <div className="ml-auto flex items-center gap-2">
              <RejectButton busy={busyId === p.id} onConfirm={() => reject(p.id)} />
              <button
                type="button"
                disabled={busyId === p.id}
                className="text-[12px] font-bold bg-green text-white rounded-md px-3.5 py-1.5 cursor-pointer disabled:opacity-60"
                onClick={() => approve(p.id)}
              >
                {busyId === p.id ? "Aprobando…" : "Aprobar"}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
