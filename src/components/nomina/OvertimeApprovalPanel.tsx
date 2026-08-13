"use client";

import { useEffect, useState } from "react";

type Pending = {
  id: string;
  employee: { id: string; name: string; department: { name: string } | null };
  date: string;
  minutesExtra: number;
  enteredByName: string | null;
};

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("es-EC", { weekday: "short", day: "numeric", month: "short" });
}
function fmtMinutes(min: number) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h === 0) return `${m}min`;
  return m === 0 ? `${h}h` : `${h}h ${m}min`;
}

// Confirmado 2026-08-13: sin tu aprobación, ese día no cuenta para nada del
// cálculo mensual — exclusivo del admin.
export function OvertimeApprovalPanel() {
  const [pending, setPending] = useState<Pending[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  function load() {
    fetch("/api/payroll/overtime/pending").then((r) => (r.ok ? r.json() : [])).then(setPending);
  }
  useEffect(load, []);

  async function approve(id: string) {
    setBusyId(id);
    await fetch(`/api/payroll/overtime/${id}/approve`, { method: "POST" });
    setBusyId(null);
    load();
  }

  if (!pending) return <div className="text-steel text-[13px]">Cargando…</div>;

  return (
    <div>
      <div className="text-[11px] font-semibold uppercase tracking-wide text-steel mb-3">
        Horas extra pendientes de aprobar ({pending.length})
      </div>
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
            <button
              type="button"
              disabled={busyId === p.id}
              className="ml-auto text-[12px] font-bold bg-green text-white rounded-md px-3.5 py-1.5 cursor-pointer disabled:opacity-60"
              onClick={() => approve(p.id)}
            >
              {busyId === p.id ? "Aprobando…" : "Aprobar"}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
