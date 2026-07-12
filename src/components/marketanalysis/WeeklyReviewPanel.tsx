"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, Pencil } from "lucide-react";

export type WeeklyReviewDTO = {
  id: string;
  week: string;
  problem: string;
  actionPlan: string;
  status: "PENDING" | "RESOLVED" | "REJECTED";
};

const STATUS_META: Record<WeeklyReviewDTO["status"], { label: string; color: string }> = {
  PENDING: { label: "Pendiente", color: "#92A3C0" },
  RESOLVED: { label: "Solucionado", color: "#14C7C7" },
  REJECTED: { label: "Rechazado", color: "#C4453A" },
};

function formatWeek(week: string) {
  const [year, w] = week.split("-W");
  return `Semana ${Number(w)} · ${year}`;
}

export function WeeklyReviewPanel({
  deptId,
  records,
  editable,
}: {
  deptId: string;
  records: WeeklyReviewDTO[];
  editable: boolean;
}) {
  const router = useRouter();
  const sorted = [...records].sort((a, b) => (a.week < b.week ? 1 : -1));

  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [week, setWeek] = useState("");
  const [problem, setProblem] = useState("");
  const [actionPlan, setActionPlan] = useState("");
  const [status, setStatus] = useState<WeeklyReviewDTO["status"]>("PENDING");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);

  const startNew = () => {
    setEditingId(null);
    setWeek("");
    setProblem("");
    setActionPlan("");
    setStatus("PENDING");
    setFormOpen(true);
    setErr("");
  };

  const startEdit = (r: WeeklyReviewDTO) => {
    setEditingId(r.id);
    setWeek(r.week);
    setProblem(r.problem);
    setActionPlan(r.actionPlan);
    setStatus(r.status);
    setFormOpen(true);
    setErr("");
  };

  const save = async () => {
    if (!week || !problem.trim() || !actionPlan.trim()) {
      setErr("Completa la semana, el problema y el plan a ejecutar.");
      return;
    }
    setErr("");
    setBusy(true);
    const res = editingId
      ? await fetch(`/api/weekly-reviews/${editingId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ problem, actionPlan, status }),
        })
      : await fetch("/api/weekly-reviews", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ deptId, week, problem, actionPlan, status }),
        });
    setBusy(false);
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setErr(data?.error ?? "No se pudo guardar el registro.");
      return;
    }
    setFormOpen(false);
    setEditingId(null);
    router.refresh();
  };

  const updateStatus = async (id: string, next: WeeklyReviewDTO["status"]) => {
    setBusy(true);
    await fetch(`/api/weekly-reviews/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: next }),
    });
    setBusy(false);
    router.refresh();
  };

  const remove = async (id: string) => {
    setBusy(true);
    await fetch(`/api/weekly-reviews/${id}`, { method: "DELETE" });
    setBusy(false);
    setConfirmingDeleteId(null);
    router.refresh();
  };

  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-4">
        <div className="text-[13px] text-steel">
          Bitácora de la reunión semanal: problemas de la semana y plan de acción. Solo visible para esta área.
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
          <div className="grid grid-cols-2 gap-3 mb-3">
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
              <label className="block mb-1 text-[10.5px] font-semibold uppercase tracking-wide text-steel">Estado</label>
              <select
                className="w-full rounded border border-rule px-2.5 py-2 text-[13.5px] bg-surface"
                value={status}
                onChange={(e) => setStatus(e.target.value as WeeklyReviewDTO["status"])}
              >
                <option value="PENDING">Pendiente</option>
                <option value="RESOLVED">Solucionado</option>
                <option value="REJECTED">Rechazado</option>
              </select>
            </div>
          </div>
          <div className="mb-3">
            <label className="block mb-1 text-[10.5px] font-semibold uppercase tracking-wide text-steel">
              Problema / cosas por mejorar
            </label>
            <textarea
              rows={2}
              className="w-full rounded border border-rule px-2.5 py-2 text-[13.5px]"
              value={problem}
              onChange={(e) => setProblem(e.target.value)}
              placeholder="Qué pasó esta semana, qué desafío tuvieron..."
            />
          </div>
          <div className="mb-3">
            <label className="block mb-1 text-[10.5px] font-semibold uppercase tracking-wide text-steel">
              Plan a ejecutar
            </label>
            <textarea
              rows={2}
              className="w-full rounded border border-rule px-2.5 py-2 text-[13.5px]"
              value={actionPlan}
              onChange={(e) => setActionPlan(e.target.value)}
              placeholder="Qué se va a hacer para corregirlo..."
            />
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
          Aún no hay registros de la reunión semanal.
        </div>
      )}

      {sorted.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr className="text-left border-b border-rule">
                <th className="py-2 pr-3 text-[10.5px] font-semibold uppercase tracking-wide text-steel whitespace-nowrap">
                  Semana
                </th>
                <th className="py-2 pr-3 text-[10.5px] font-semibold uppercase tracking-wide text-steel">
                  Problema / cosas por mejorar
                </th>
                <th className="py-2 pr-3 text-[10.5px] font-semibold uppercase tracking-wide text-steel">
                  Plan a ejecutar
                </th>
                <th className="py-2 pr-3 text-[10.5px] font-semibold uppercase tracking-wide text-steel whitespace-nowrap">
                  Estado
                </th>
                {editable && <th className="py-2 text-[10.5px] font-semibold uppercase tracking-wide text-steel" />}
              </tr>
            </thead>
            <tbody>
              {sorted.map((r) => (
                <tr key={r.id} className="border-b border-rule align-top">
                  <td className="py-3 pr-3 text-[13px] font-semibold whitespace-nowrap">{formatWeek(r.week)}</td>
                  <td className="py-3 pr-3 text-[13px] text-ink/90 max-w-[280px]">{r.problem}</td>
                  <td className="py-3 pr-3 text-[13px] text-ink/90 max-w-[280px]">{r.actionPlan}</td>
                  <td className="py-3 pr-3 whitespace-nowrap">
                    {editable ? (
                      <select
                        className="rounded-full border px-2.5 py-1 text-[11px] font-semibold cursor-pointer bg-transparent"
                        style={{ color: STATUS_META[r.status].color, borderColor: STATUS_META[r.status].color }}
                        value={r.status}
                        onChange={(e) => updateStatus(r.id, e.target.value as WeeklyReviewDTO["status"])}
                        disabled={busy}
                      >
                        <option value="PENDING">Pendiente</option>
                        <option value="RESOLVED">Solucionado</option>
                        <option value="REJECTED">Rechazado</option>
                      </select>
                    ) : (
                      <span
                        className="font-mono text-[10.5px] font-semibold px-2.5 py-1 rounded-full"
                        style={{
                          color: STATUS_META[r.status].color,
                          border: `1px solid ${STATUS_META[r.status].color}`,
                          background: `${STATUS_META[r.status].color}1a`,
                        }}
                      >
                        {STATUS_META[r.status].label}
                      </span>
                    )}
                  </td>
                  {editable && (
                    <td className="py-3 whitespace-nowrap">
                      <div className="flex items-center gap-2">
                        <button type="button" className="text-steel hover:text-ink cursor-pointer" onClick={() => startEdit(r)}>
                          <Pencil size={14} />
                        </button>
                        {confirmingDeleteId === r.id ? (
                          <span className="flex items-center gap-1.5">
                            <button
                              type="button"
                              className="text-red text-[11.5px] font-semibold cursor-pointer"
                              disabled={busy}
                              onClick={() => remove(r.id)}
                            >
                              Eliminar
                            </button>
                            <button
                              type="button"
                              className="text-steel text-[11.5px] cursor-pointer"
                              onClick={() => setConfirmingDeleteId(null)}
                            >
                              Cancelar
                            </button>
                          </span>
                        ) : (
                          <button
                            type="button"
                            className="text-steel hover:text-red cursor-pointer"
                            onClick={() => setConfirmingDeleteId(r.id)}
                          >
                            <Trash2 size={14} />
                          </button>
                        )}
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
