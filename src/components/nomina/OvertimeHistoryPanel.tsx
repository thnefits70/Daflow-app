"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, XCircle } from "lucide-react";

type Entry = {
  id: string;
  employee: { id: string; name: string; department: { name: string } | null };
  date: string;
  minutesExtra: number;
  enteredByName: string | null;
  approvedAt: string | null;
  rejectedAt: string | null;
};

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("es-EC", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
}
function fmtMinutes(min: number) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h === 0) return `${m}min`;
  return m === 0 ? `${h}h` : `${h}h ${m}min`;
}

// Solo lectura — admin y Nairoby ven aquí todo lo aprobado y rechazado de
// todas las áreas, últimos 60 días.
export function OvertimeHistoryPanel() {
  const [entries, setEntries] = useState<Entry[] | null>(null);

  useEffect(() => {
    fetch("/api/payroll/overtime/history").then((r) => (r.ok ? r.json() : [])).then(setEntries);
  }, []);

  if (!entries) return <div className="text-steel text-[13px]">Cargando…</div>;

  return (
    <div>
      <div className="text-[11px] font-semibold uppercase tracking-wide text-steel mb-3">
        Historial de horas extra — todas las áreas ({entries.length})
      </div>
      {entries.length === 0 && (
        <div className="border-[1.5px] border-dashed border-rule rounded-md p-8 text-center text-steel text-[13px]">
          Todavía no hay nada resuelto.
        </div>
      )}
      <div className="flex flex-col gap-2">
        {entries.map((e) => (
          <div key={e.id} className="bg-surface border border-rule rounded-md p-3.5 flex items-center gap-3 flex-wrap">
            <span className="font-semibold text-[13px] min-w-[110px]">{fmtDate(e.date)}</span>
            <span className="text-[12.5px] text-ink">{fmtMinutes(e.minutesExtra)} extra</span>
            <span className="text-[12px] text-steel">{e.employee.name} · {e.employee.department?.name ?? "—"}</span>
            <span className="text-[10.5px] text-steel-dim">cargado por {e.enteredByName ?? "—"}</span>
            <span className="ml-auto">
              {e.approvedAt ? (
                <span className="flex items-center gap-1 text-[10.5px] font-semibold text-green bg-green/10 border border-green/30 rounded-full px-2 py-0.5">
                  <CheckCircle2 size={10} /> Aprobado
                </span>
              ) : (
                <span className="flex items-center gap-1 text-[10.5px] font-semibold text-red bg-red/10 border border-red/30 rounded-full px-2 py-0.5">
                  <XCircle size={10} /> Rechazado
                </span>
              )}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
