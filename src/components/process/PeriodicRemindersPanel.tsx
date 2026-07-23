"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Check, Undo2, Trash2, Pencil } from "lucide-react";

type CompletionDTO = { period: string; completedAt: string; completedByName: string | null };
type ReminderDTO = {
  id: string;
  title: string;
  detail: string;
  recurrence: "DAILY" | "WEEKLY" | "ONCE";
  weekday: number | null;
  date: string | null;
  timeOfDay: string | null;
  isActive: boolean;
  completions: CompletionDTO[];
};

const WEEKDAY_NAMES = ["", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];

function pad2(n: number) {
  return String(n).padStart(2, "0");
}
function todayStr(d: Date) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
function isoWeekOf(d: Date): string {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const weekNum = Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${date.getUTCFullYear()}-W${pad2(weekNum)}`;
}
function currentPeriodFor(r: { recurrence: ReminderDTO["recurrence"] }): string {
  if (r.recurrence === "DAILY") return todayStr(new Date());
  if (r.recurrence === "WEEKLY") return isoWeekOf(new Date());
  return "once";
}
function recurrenceLabel(r: ReminderDTO): string {
  if (r.recurrence === "DAILY") return `Diario${r.timeOfDay ? ` · ${r.timeOfDay}` : ""}`;
  if (r.recurrence === "WEEKLY") return `Semanal · ${WEEKDAY_NAMES[r.weekday ?? 0]}${r.timeOfDay ? ` · ${r.timeOfDay}` : ""}`;
  const d = r.date ? new Date(r.date) : null;
  const dateLabel = d ? `${pad2(d.getUTCDate())}/${pad2(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}` : "";
  return `Una vez · ${dateLabel}${r.timeOfDay ? ` · ${r.timeOfDay}` : ""}`;
}

const emptyForm = { title: "", detail: "", recurrence: "DAILY" as ReminderDTO["recurrence"], weekday: "1", date: "", timeOfDay: "" };

export function PeriodicRemindersPanel({ deptId, reminders, editable }: { deptId: string; reminders: ReminderDTO[]; editable: boolean }) {
  const router = useRouter();
  const [tab, setTab] = useState<"active" | "inactive">("active");
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const activeReminders = reminders.filter((r) => r.isActive);
  const inactiveReminders = reminders.filter((r) => !r.isActive);
  const shown = tab === "active" ? activeReminders : inactiveReminders;

  const startNew = () => {
    setEditingId(null);
    setForm(emptyForm);
    setShowForm(true);
    setErr("");
  };

  const startEdit = (r: ReminderDTO) => {
    setEditingId(r.id);
    setForm({
      title: r.title,
      detail: r.detail,
      recurrence: r.recurrence,
      weekday: String(r.weekday ?? 1),
      date: r.date ? r.date.slice(0, 10) : "",
      timeOfDay: r.timeOfDay ?? "",
    });
    setShowForm(true);
    setErr("");
  };

  const save = async () => {
    if (!form.title.trim()) return setErr("Ponle un título al recordatorio.");
    if (form.recurrence === "ONCE" && !form.date) return setErr("Elige la fecha.");
    setErr("");
    setBusy(true);
    const body = {
      deptId,
      title: form.title.trim(),
      detail: form.detail.trim() || undefined,
      recurrence: form.recurrence,
      weekday: form.recurrence === "WEEKLY" ? Number(form.weekday) : undefined,
      date: form.recurrence === "ONCE" ? form.date : undefined,
      timeOfDay: form.timeOfDay || undefined,
    };
    const res = editingId
      ? await fetch(`/api/periodic-reminders/${editingId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        })
      : await fetch("/api/periodic-reminders", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
    setBusy(false);
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setErr(data?.error ?? "No se pudo guardar el recordatorio.");
      return;
    }
    setShowForm(false);
    setEditingId(null);
    router.refresh();
  };

  const toggleActive = async (id: string, isActive: boolean) => {
    setBusy(true);
    await fetch(`/api/periodic-reminders/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: !isActive }),
    });
    setBusy(false);
    router.refresh();
  };

  const remove = async (id: string) => {
    setBusy(true);
    await fetch(`/api/periodic-reminders/${id}`, { method: "DELETE" });
    setBusy(false);
    router.refresh();
  };

  const complete = async (id: string, period: string) => {
    setBusy(true);
    await fetch(`/api/periodic-reminders/${id}/complete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ period }),
    });
    setBusy(false);
    router.refresh();
  };

  const undo = async (id: string, period: string) => {
    setBusy(true);
    await fetch(`/api/periodic-reminders/${id}/complete?period=${encodeURIComponent(period)}`, { method: "DELETE" });
    setBusy(false);
    router.refresh();
  };

  return (
    <div>
      <div className="text-[13px] text-steel mb-4 max-w-2xl">
        Recordatorios internos con su propia periodicidad — diario, semanal o una fecha específica, con hora
        opcional. Al marcar "Realizado" desaparece hasta que vuelva a tocar automáticamente (mañana, la próxima
        semana, o nunca más si es de una sola vez).
      </div>

      <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setTab("active")}
            className={`rounded-full px-3.5 py-1.5 text-[12.5px] font-semibold border cursor-pointer ${tab === "active" ? "bg-blue border-blue text-white" : "border-rule text-steel hover:border-blue"}`}
          >
            Activos ({activeReminders.length})
          </button>
          <button
            type="button"
            onClick={() => setTab("inactive")}
            className={`rounded-full px-3.5 py-1.5 text-[12.5px] font-semibold border cursor-pointer ${tab === "inactive" ? "bg-blue border-blue text-white" : "border-rule text-steel hover:border-blue"}`}
          >
            Inactivos ({inactiveReminders.length})
          </button>
        </div>
        {editable && (
          <button
            type="button"
            className="inline-flex items-center gap-1.5 rounded border border-blue bg-blue px-3.5 py-2 text-[12.5px] font-semibold text-white cursor-pointer"
            onClick={startNew}
          >
            <Plus size={14} /> Agregar recordatorio
          </button>
        )}
      </div>

      {editable && showForm && (
        <div className="bg-surface border border-rule rounded p-4 mb-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
            <input
              className="rounded border border-rule px-2.5 py-2 text-[13.5px] sm:col-span-2"
              placeholder="Título (ej. Revisar inventario físico)"
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
            />
            <textarea
              className="rounded border border-rule px-2.5 py-2 text-[13.5px] sm:col-span-2"
              rows={2}
              placeholder="Detalle (opcional)"
              value={form.detail}
              onChange={(e) => setForm((f) => ({ ...f, detail: e.target.value }))}
            />
            <div>
              <label className="block mb-1 text-[10.5px] font-semibold uppercase tracking-wide text-steel">Repetición</label>
              <select
                className="w-full rounded border border-rule px-2.5 py-2 text-[13.5px] bg-surface"
                value={form.recurrence}
                onChange={(e) => setForm((f) => ({ ...f, recurrence: e.target.value as ReminderDTO["recurrence"] }))}
              >
                <option value="DAILY">Diario</option>
                <option value="WEEKLY">Semanal</option>
                <option value="ONCE">Una vez</option>
              </select>
            </div>
            <div>
              <label className="block mb-1 text-[10.5px] font-semibold uppercase tracking-wide text-steel">Hora (opcional)</label>
              <input
                type="time"
                className="w-full rounded border border-rule px-2.5 py-2 text-[13.5px]"
                value={form.timeOfDay}
                onChange={(e) => setForm((f) => ({ ...f, timeOfDay: e.target.value }))}
              />
            </div>
            {form.recurrence === "WEEKLY" && (
              <div>
                <label className="block mb-1 text-[10.5px] font-semibold uppercase tracking-wide text-steel">Día de la semana</label>
                <select
                  className="w-full rounded border border-rule px-2.5 py-2 text-[13.5px] bg-surface"
                  value={form.weekday}
                  onChange={(e) => setForm((f) => ({ ...f, weekday: e.target.value }))}
                >
                  {WEEKDAY_NAMES.slice(1).map((name, i) => (
                    <option key={i + 1} value={i + 1}>{name}</option>
                  ))}
                </select>
              </div>
            )}
            {form.recurrence === "ONCE" && (
              <div>
                <label className="block mb-1 text-[10.5px] font-semibold uppercase tracking-wide text-steel">Fecha</label>
                <input
                  type="date"
                  className="w-full rounded border border-rule px-2.5 py-2 text-[13.5px]"
                  value={form.date}
                  onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
                />
              </div>
            )}
          </div>
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              disabled={busy}
              className="rounded border border-blue bg-blue px-4 py-2 text-[13px] font-semibold text-white cursor-pointer disabled:opacity-60"
              onClick={save}
            >
              {editingId ? "Guardar cambios" : "Guardar recordatorio"}
            </button>
            <button
              type="button"
              className="text-steel text-[13px] cursor-pointer"
              onClick={() => {
                setShowForm(false);
                setEditingId(null);
              }}
            >
              Cancelar
            </button>
          </div>
          {err && <div className="text-red text-[12.5px] mt-2">{err}</div>}
        </div>
      )}

      {shown.length === 0 && (
        <div className="border-[1.5px] border-dashed border-rule rounded-md p-8.5 text-center text-steel text-[13.5px]">
          {tab === "active" ? "Aún no hay recordatorios configurados." : "No hay recordatorios inactivos."}
        </div>
      )}

      <div className="space-y-2.5">
        {shown.map((r) => {
          const period = currentPeriodFor(r);
          const rec = r.completions.find((c) => c.period === period);
          return (
            <div key={r.id} className="bg-surface border border-rule rounded p-4">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div>
                  <div className="font-semibold text-[14px]">{r.title}</div>
                  {r.detail && <div className="text-[12.5px] text-ink/80 mt-0.5 max-w-md">{r.detail}</div>}
                  <div className="text-[12px] text-steel mt-0.5">{recurrenceLabel(r)}</div>
                </div>
                <span className={`text-[12.5px] font-semibold whitespace-nowrap ${rec ? "text-green" : "text-steel"}`}>
                  {rec ? "Realizado" : "Pendiente"}
                </span>
              </div>

              {editable && (
                <div className="flex items-center justify-end gap-2 mt-3 flex-wrap">
                  {rec ? (
                    <button
                      type="button"
                      disabled={busy}
                      className="inline-flex items-center gap-1 text-[12px] text-steel border border-rule rounded px-2.5 py-1.5 cursor-pointer disabled:opacity-60"
                      onClick={() => undo(r.id, period)}
                    >
                      <Undo2 size={12} /> No realizado
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled={busy}
                      className="inline-flex items-center gap-1 text-[12px] font-semibold text-white bg-teal border border-teal rounded px-2.5 py-1.5 cursor-pointer disabled:opacity-60"
                      onClick={() => complete(r.id, period)}
                    >
                      <Check size={12} /> Realizado
                    </button>
                  )}
                  <button
                    type="button"
                    className="text-steel hover:text-ink cursor-pointer"
                    onClick={() => startEdit(r)}
                    title="Editar"
                  >
                    <Pencil size={14} />
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    className="text-[12px] text-steel border border-rule rounded px-2.5 py-1.5 cursor-pointer disabled:opacity-60"
                    onClick={() => toggleActive(r.id, r.isActive)}
                  >
                    {r.isActive ? "Desactivar" : "Activar"}
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    className="text-steel hover:text-red cursor-pointer disabled:opacity-60"
                    onClick={() => remove(r.id)}
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
