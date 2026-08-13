"use client";

import { useEffect, useState } from "react";
import { Clock, Lock, CheckCircle2 } from "lucide-react";

type TeamMember = { id: string; name: string; scheduleLabel: string };
type Entry = {
  id: string;
  employee: { id: string; name: string };
  date: string;
  minutesExtra: number;
  enteredByName: string | null;
  approvedAt: string | null;
  editable: boolean;
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

// Confirmado 2026-08-13: pedido explícito del usuario — el líder de cada
// área carga, día por día, cuánto se quedó extra (él mismo o su equipo),
// solo en pasos de 45 min o 1 hora, con doble confirmación antes de
// enviar. Solo se puede cargar/corregir dentro de las 24h del día
// trabajado — pasado eso queda bloqueado para siempre.
export function OvertimeEntryPanel() {
  const [team, setTeam] = useState<TeamMember[] | null>(null);
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [employeeId, setEmployeeId] = useState("");
  const [minutes, setMinutes] = useState(0);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const today = new Date().toISOString().slice(0, 10);

  function load() {
    fetch("/api/payroll/my-team").then((r) => (r.ok ? r.json() : [])).then((t) => {
      setTeam(t);
      if (t[0]) setEmployeeId(t[0].id);
    });
    fetch("/api/payroll/overtime").then((r) => (r.ok ? r.json() : [])).then(setEntries);
  }
  useEffect(load, []);

  async function send() {
    setBusy(true);
    setErr("");
    const res = await fetch("/api/payroll/overtime", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ employeeId, date: today, minutesExtra: minutes }),
    });
    setBusy(false);
    setConfirming(false);
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      setErr(data?.error ?? "No se pudo enviar.");
      return;
    }
    setMinutes(0);
    load();
  }

  if (!team) return <div className="text-steel text-[13px]">Cargando…</div>;

  const selected = team.find((t) => t.id === employeeId);

  return (
    <div>
      <div className="bg-surface border border-rule rounded-md p-4 mb-4">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-steel mb-3">
          Registrar hoy — {fmtDate(new Date().toISOString())}
        </div>
        <div className="flex items-end gap-3 flex-wrap">
          <div>
            <label className="block mb-1 text-[10px] font-semibold uppercase tracking-wide text-steel">Colaborador</label>
            <select className="rounded border border-rule bg-cloud px-2.5 py-2 text-[13px]" value={employeeId} onChange={(e) => { setEmployeeId(e.target.value); setMinutes(0); }}>
              {team.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block mb-1 text-[10px] font-semibold uppercase tracking-wide text-steel">Se quedó extra</label>
            <div className="flex gap-2">
              <button
                type="button"
                className={`text-[12px] font-bold rounded-md px-3.5 py-2 border-[1.5px] cursor-pointer ${minutes > 0 ? "border-teal text-teal bg-teal/10" : "border-rule text-steel"}`}
                onClick={() => setMinutes((m) => m + 45)}
              >
                +45 min
              </button>
              <button
                type="button"
                className={`text-[12px] font-bold rounded-md px-3.5 py-2 border-[1.5px] cursor-pointer ${minutes > 0 ? "border-teal text-teal bg-teal/10" : "border-rule text-steel"}`}
                onClick={() => setMinutes((m) => m + 60)}
              >
                +1 hora
              </button>
              {minutes > 0 && (
                <button type="button" className="text-[11.5px] text-steel underline cursor-pointer" onClick={() => setMinutes(0)}>
                  Reiniciar
                </button>
              )}
            </div>
          </div>
          {minutes > 0 && (
            <div className="text-[13px] font-bold text-ink">{fmtMinutes(minutes)}</div>
          )}
          <button
            type="button"
            disabled={minutes === 0}
            className="text-[12.5px] font-bold rounded-md px-4 py-2 bg-blue text-white cursor-pointer disabled:opacity-40"
            onClick={() => setConfirming(true)}
          >
            Enviar
          </button>
        </div>
        {selected && <div className="text-[11px] text-steel-dim mt-2.5">{selected.scheduleLabel}</div>}
        {err && <div className="text-red text-[12px] mt-2">{err}</div>}

        {confirming && (
          <div className="mt-3.5 max-w-sm border-[1.5px] border-teal rounded-md bg-cloud p-4">
            <div className="text-[13px] font-bold mb-3">¿Estás seguro que estas son las horas extras reales?</div>
            <div className="flex gap-2">
              <button type="button" className="text-[12px] font-semibold border border-rule rounded px-3 py-1.5 cursor-pointer" onClick={() => setConfirming(false)}>
                No, corregir
              </button>
              <button type="button" disabled={busy} className="text-[12px] font-bold bg-blue text-white rounded px-3 py-1.5 cursor-pointer disabled:opacity-60" onClick={send}>
                {busy ? "Enviando…" : "Sí, enviar"}
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="bg-surface border border-rule rounded-md p-4">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-steel mb-3">Días enviados — últimas semanas</div>
        {(entries?.length ?? 0) === 0 && <div className="text-steel text-[12.5px]">Todavía no hay nada registrado.</div>}
        <div className="flex flex-col">
          {entries?.map((e) => (
            <div key={e.id} className="flex items-center gap-3 py-2.5 border-b border-rule last:border-0 text-[12.5px] flex-wrap">
              <span className="font-semibold min-w-[110px]">{fmtDate(e.date)}</span>
              {e.editable ? (
                <span className="text-steel">{fmtMinutes(e.minutesExtra)} extra</span>
              ) : (
                <span className="text-steel">{fmtMinutes(e.minutesExtra)} extra</span>
              )}
              <span className="text-steel-dim text-[11px]">{e.employee.name}</span>
              <span className="ml-auto">
                {e.approvedAt ? (
                  <span className="flex items-center gap-1 text-[10.5px] font-semibold text-green bg-green/10 border border-green/30 rounded-full px-2 py-0.5">
                    <CheckCircle2 size={10} /> Aprobado
                  </span>
                ) : e.editable ? (
                  <span className="flex items-center gap-1 text-[10.5px] font-semibold bg-gold/10 border border-gold/35 rounded-full px-2 py-0.5" style={{ color: "#D9A441" }}>
                    <Clock size={10} /> Esperando aprobación
                  </span>
                ) : (
                  <span className="flex items-center gap-1 text-[10.5px] text-steel-dim italic">
                    <Lock size={10} /> Ya pasaron 24h
                  </span>
                )}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
