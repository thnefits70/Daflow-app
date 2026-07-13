"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, Pencil } from "lucide-react";

export type WeeklyMetricDTO = {
  id: string;
  week: string; // "YYYY-Www"
  value: number;
  notDispatched: number | null;
};

function formatWeek(week: string) {
  const [year, w] = week.split("-W");
  return `Semana ${Number(w)} · ${year}`;
}

function fillRate(value: number, notDispatched: number | null) {
  if (notDispatched === null) return null;
  const total = value + notDispatched;
  if (total === 0) return null;
  return Math.round((value / total) * 100);
}

function fillRateColor(pct: number) {
  if (pct >= 100) return "#14C7C7";
  if (pct >= 80) return "#1E5EFF";
  return "#C4453A";
}

export function WeeklyMetricPanel({
  deptId,
  records,
  editable,
  label,
}: {
  deptId: string;
  records: WeeklyMetricDTO[];
  editable: boolean;
  label: string;
}) {
  const router = useRouter();
  const sorted = [...records].sort((a, b) => (a.week < b.week ? 1 : -1));

  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [week, setWeek] = useState("");
  const [value, setValue] = useState("");
  const [notDispatched, setNotDispatched] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const startNew = () => {
    setEditingId(null);
    setWeek("");
    setValue("");
    setNotDispatched("");
    setFormOpen(true);
    setErr("");
  };

  const startEdit = (r: WeeklyMetricDTO) => {
    setEditingId(r.id);
    setWeek(r.week);
    setValue(String(r.value));
    setNotDispatched(r.notDispatched === null ? "" : String(r.notDispatched));
    setFormOpen(true);
    setErr("");
  };

  const save = async () => {
    if (!week || value === "") {
      setErr("Completa la semana y el valor.");
      return;
    }
    setErr("");
    setBusy(true);
    const payload = {
      value: Number(value),
      notDispatched: notDispatched === "" ? null : Number(notDispatched),
    };
    const res = editingId
      ? await fetch(`/api/weekly-metrics/${editingId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        })
      : await fetch("/api/weekly-metrics", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ deptId, week, ...payload }),
        });
    setBusy(false);
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setErr(data?.error ?? "No se pudo guardar el registro.");
      return;
    }
    setFormOpen(false);
    setEditingId(null);
    setWeek("");
    setValue("");
    setNotDispatched("");
    router.refresh();
  };

  const remove = async (id: string) => {
    setBusy(true);
    await fetch(`/api/weekly-metrics/${id}`, { method: "DELETE" });
    setBusy(false);
    router.refresh();
  };

  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-4">
        <div className="text-[13px] text-steel">
          Registro semanal de {label.toLowerCase()}. Se muestra en Inicio para todo el equipo.
        </div>
        {editable && (
          <button
            type="button"
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded border border-blue bg-blue px-3.5 py-2 text-[12.5px] font-semibold text-white cursor-pointer disabled:opacity-60 shrink-0"
            onClick={startNew}
          >
            <Plus size={14} /> Nuevo registro
          </button>
        )}
      </div>

      {formOpen && (
        <div className="bg-surface border border-rule rounded-md p-4.5 mb-4">
          <div className="grid grid-cols-3 gap-3 mb-3">
            <div>
              <label className="block mb-1 text-[10.5px] font-semibold uppercase tracking-wide text-steel">Semana</label>
              <input
                type="week"
                disabled={!!editingId}
                className="w-full rounded border border-rule px-2.5 py-2 text-[13.5px] disabled:bg-cloud disabled:text-steel"
                value={week}
                onChange={(e) => setWeek(e.target.value)}
              />
            </div>
            <div>
              <label className="block mb-1 text-[10.5px] font-semibold uppercase tracking-wide text-steel">{label}</label>
              <input
                type="number"
                min={0}
                step="1"
                className="w-full rounded border border-rule px-2.5 py-2 text-[13.5px]"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder="ej. 1450"
              />
            </div>
            <div>
              <label className="block mb-1 text-[10.5px] font-semibold uppercase tracking-wide text-steel">
                Pedidos no despachados
              </label>
              <input
                type="number"
                min={0}
                step="1"
                className="w-full rounded border border-rule px-2.5 py-2 text-[13.5px]"
                value={notDispatched}
                onChange={(e) => setNotDispatched(e.target.value)}
                placeholder="ej. 150"
              />
            </div>
          </div>
          <div className="text-[11.5px] text-steel mb-3">
            Opcional — con este dato calculamos el Fill Rate: pedidos despachados ÷ (despachados + no despachados).
          </div>
          {err && <div className="text-red text-[12.5px] mb-2.5">{err}</div>}
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              disabled={busy}
              className="rounded border border-blue bg-blue px-4 py-2 text-[13px] font-semibold text-white cursor-pointer disabled:opacity-60"
              onClick={save}
            >
              Guardar
            </button>
            <button
              type="button"
              className="text-steel text-[13px] cursor-pointer"
              onClick={() => {
                setFormOpen(false);
                setEditingId(null);
              }}
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {sorted.length === 0 && !formOpen && (
        <div className="border-[1.5px] border-dashed border-rule rounded-md p-8.5 text-center text-steel text-[13.5px]">
          Aún no hay registros semanales.
        </div>
      )}

      {sorted.map((r) => {
        const rate = fillRate(r.value, r.notDispatched);
        return (
          <div key={r.id} className="bg-surface border border-rule rounded p-3.5 mb-2 flex items-center justify-between gap-3">
            <span className="font-semibold text-[13.5px]">{formatWeek(r.week)}</span>
            <div className="flex items-center gap-4">
              <span className="font-mono text-[13.5px]">{r.value.toLocaleString("es-MX")} despachados</span>
              {r.notDispatched !== null && (
                <span className="font-mono text-[13.5px] text-steel">{r.notDispatched.toLocaleString("es-MX")} pendientes</span>
              )}
              {rate !== null && (
                <span
                  className="font-mono text-[11px] font-semibold px-2.5 py-1 rounded-full"
                  style={{ color: fillRateColor(rate), border: `1px solid ${fillRateColor(rate)}`, background: `${fillRateColor(rate)}1a` }}
                >
                  Fill Rate {rate}%
                </span>
              )}
              {editable && (
                <div className="flex items-center gap-2">
                  <button type="button" className="text-steel hover:text-ink cursor-pointer" onClick={() => startEdit(r)}>
                    <Pencil size={14} />
                  </button>
                  <button type="button" className="text-steel hover:text-red cursor-pointer" onClick={() => remove(r.id)}>
                    <Trash2 size={14} />
                  </button>
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
