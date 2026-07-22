"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Check, Undo2, Trash2 } from "lucide-react";

type RecordDTO = { period: string; amountPaid: number; completedAt: string; completedByName: string | null };
type ReminderDTO = {
  id: string;
  name: string;
  paymentMethod: string | null;
  dueDay: number;
  reminderStartDay: number;
  isActive: boolean;
  records: RecordDTO[];
};

function currentPeriod() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function fmtMoney(n: number) {
  return n.toLocaleString("es-EC", { style: "currency", currency: "USD" });
}

export function PaymentRemindersPanel({
  deptId,
  reminders,
  editable,
}: {
  deptId: string;
  reminders: ReminderDTO[];
  editable: boolean;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<"active" | "inactive">("active");
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("");
  const [dueDay, setDueDay] = useState("5");
  const [reminderStartDay, setReminderStartDay] = useState("3");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [amountDraftFor, setAmountDraftFor] = useState<string | null>(null);
  const [amountValue, setAmountValue] = useState("");

  const period = currentPeriod();
  const activeReminders = reminders.filter((r) => r.isActive);
  const inactiveReminders = reminders.filter((r) => !r.isActive);
  const shown = tab === "active" ? activeReminders : inactiveReminders;

  const create = async () => {
    const due = Number(dueDay);
    const start = Number(reminderStartDay);
    if (!name.trim()) return setErr("Ponle un nombre (empresa o plataforma a la que se paga).");
    if (!due || due < 1 || due > 31) return setErr("El día de vencimiento debe estar entre 1 y 31.");
    if (!start || start < 1 || start > 31) return setErr("El día para empezar a recordar debe estar entre 1 y 31.");
    setErr("");
    setBusy(true);
    const res = await fetch("/api/payment-reminders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        deptId,
        name: name.trim(),
        paymentMethod: paymentMethod.trim() || undefined,
        dueDay: due,
        reminderStartDay: start,
      }),
    });
    setBusy(false);
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setErr(data?.error ?? "No se pudo crear el recordatorio.");
      return;
    }
    setName("");
    setPaymentMethod("");
    setDueDay("5");
    setReminderStartDay("3");
    setShowForm(false);
    router.refresh();
  };

  const toggleActive = async (id: string, isActive: boolean) => {
    setBusy(true);
    await fetch(`/api/payment-reminders/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: !isActive }),
    });
    setBusy(false);
    router.refresh();
  };

  const remove = async (id: string) => {
    setBusy(true);
    await fetch(`/api/payment-reminders/${id}`, { method: "DELETE" });
    setBusy(false);
    router.refresh();
  };

  const submitAmount = async (id: string) => {
    const amount = Number(amountValue);
    if (!amount || amount <= 0) return setErr("Ingresa el monto que se pagó.");
    setErr("");
    setBusy(true);
    await fetch(`/api/payment-reminders/${id}/complete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ period, amountPaid: amount }),
    });
    setBusy(false);
    setAmountDraftFor(null);
    setAmountValue("");
    router.refresh();
  };

  const undo = async (id: string) => {
    setBusy(true);
    await fetch(`/api/payment-reminders/${id}/complete?period=${period}`, { method: "DELETE" });
    setBusy(false);
    router.refresh();
  };

  return (
    <div>
      <div className="text-[13px] text-steel mb-4 max-w-2xl">
        Recordatorios de pagos mensuales variados — suscripciones, servicios, tarjetas. Cada uno pone su propio
        monto real al marcarlo como pagado, porque el valor cambia mes a mes.
      </div>

      <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setTab("active")}
            className={`rounded-full px-3.5 py-1.5 text-[12.5px] font-semibold border cursor-pointer ${
              tab === "active" ? "bg-blue border-blue text-white" : "border-rule text-steel hover:border-blue"
            }`}
          >
            Activos ({activeReminders.length})
          </button>
          <button
            type="button"
            onClick={() => setTab("inactive")}
            className={`rounded-full px-3.5 py-1.5 text-[12.5px] font-semibold border cursor-pointer ${
              tab === "inactive" ? "bg-blue border-blue text-white" : "border-rule text-steel hover:border-blue"
            }`}
          >
            Inactivos ({inactiveReminders.length})
          </button>
        </div>
        {editable && (
          <button
            type="button"
            className="inline-flex items-center gap-1.5 rounded border border-blue bg-blue px-3.5 py-2 text-[12.5px] font-semibold text-white cursor-pointer"
            onClick={() => setShowForm((s) => !s)}
          >
            <Plus size={14} /> Agregar pago
          </button>
        )}
      </div>

      {editable && showForm && (
        <div className="bg-surface border border-rule rounded p-4 mb-4">
          <div className="grid grid-cols-2 gap-3 mb-3">
            <input
              className="rounded border border-rule px-2.5 py-2 text-[13.5px]"
              placeholder="Empresa o plataforma (ej. Internet CNT)"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <input
              className="rounded border border-rule px-2.5 py-2 text-[13.5px]"
              placeholder="Método de pago (ej. tarjeta Visa ***1234)"
              value={paymentMethod}
              onChange={(e) => setPaymentMethod(e.target.value)}
            />
            <div>
              <label className="block mb-1 text-[10.5px] font-semibold uppercase tracking-wide text-steel">
                Día de vencimiento
              </label>
              <input
                type="number"
                min={1}
                max={31}
                className="w-full rounded border border-rule px-2.5 py-2 text-[13.5px]"
                value={dueDay}
                onChange={(e) => setDueDay(e.target.value)}
              />
            </div>
            <div>
              <label className="block mb-1 text-[10.5px] font-semibold uppercase tracking-wide text-steel">
                Empezar a recordar desde el día
              </label>
              <input
                type="number"
                min={1}
                max={31}
                className="w-full rounded border border-rule px-2.5 py-2 text-[13.5px]"
                value={reminderStartDay}
                onChange={(e) => setReminderStartDay(e.target.value)}
              />
            </div>
          </div>
          <button
            type="button"
            disabled={busy}
            className="rounded border border-blue bg-blue px-4 py-2 text-[13px] font-semibold text-white cursor-pointer disabled:opacity-60"
            onClick={create}
          >
            Guardar recordatorio
          </button>
          {err && <div className="text-red text-[12.5px] mt-2">{err}</div>}
        </div>
      )}

      {shown.length === 0 && (
        <div className="border-[1.5px] border-dashed border-rule rounded-md p-8.5 text-center text-steel text-[13.5px]">
          {tab === "active" ? "Aún no hay pagos configurados." : "No hay pagos inactivos."}
        </div>
      )}

      <div className="space-y-2.5">
        {shown.map((r) => {
          const rec = r.records.find((x) => x.period === period);
          return (
            <div key={r.id} className="bg-surface border border-rule rounded p-4">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div>
                  <div className="font-semibold text-[14px]">{r.name}</div>
                  <div className="text-[12px] text-steel mt-0.5">
                    {r.paymentMethod && <>{r.paymentMethod} · </>}
                    Vence el día {r.dueDay} · recuerda desde el día {r.reminderStartDay}
                  </div>
                </div>

                {!editable ? (
                  <span className={`text-[12.5px] font-semibold ${rec ? "text-green" : "text-steel"}`}>
                    {rec ? `Realizado · ${fmtMoney(rec.amountPaid)}` : "No realizado"}
                  </span>
                ) : (
                  <div className="flex items-center gap-2 flex-wrap">
                    {rec ? (
                      <>
                        <span className="text-green text-[12.5px] font-semibold">
                          Realizado · {fmtMoney(rec.amountPaid)}
                        </span>
                        <button
                          type="button"
                          disabled={busy}
                          className="inline-flex items-center gap-1 text-[12px] text-steel border border-rule rounded px-2.5 py-1.5 cursor-pointer disabled:opacity-60"
                          onClick={() => undo(r.id)}
                        >
                          <Undo2 size={12} /> No realizado
                        </button>
                      </>
                    ) : amountDraftFor === r.id ? (
                      <>
                        <div className="relative">
                          <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-green font-semibold text-[13px]">
                            $
                          </span>
                          <input
                            type="number"
                            step="0.01"
                            min={0}
                            autoFocus
                            placeholder="45.00"
                            className="w-28 rounded border border-green/50 bg-green/5 pl-5 pr-2 py-1.5 text-[13px] font-semibold text-green focus:outline-none focus:border-green"
                            value={amountValue}
                            onChange={(e) => setAmountValue(e.target.value)}
                          />
                        </div>
                        <button
                          type="button"
                          disabled={busy}
                          className="text-[12px] font-semibold text-white bg-blue border border-blue rounded px-2.5 py-1.5 cursor-pointer disabled:opacity-60"
                          onClick={() => submitAmount(r.id)}
                        >
                          Guardar
                        </button>
                        <button
                          type="button"
                          className="text-[12px] text-steel cursor-pointer"
                          onClick={() => {
                            setAmountDraftFor(null);
                            setErr("");
                          }}
                        >
                          Cancelar
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 text-[12px] font-semibold text-white bg-teal border border-teal rounded px-2.5 py-1.5 cursor-pointer"
                        onClick={() => {
                          setAmountDraftFor(r.id);
                          setAmountValue("");
                          setErr("");
                        }}
                      >
                        <Check size={12} /> Realizado
                      </button>
                    )}
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
              {editable && amountDraftFor === r.id && err && <div className="text-red text-[12px] mt-2">{err}</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
