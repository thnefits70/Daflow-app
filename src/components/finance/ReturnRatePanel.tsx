"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { formatMonthShort, returnRateStatus } from "@/components/dashboard/WeeklyTrendChart";

export type ReturnRateRecordDTO = { id: string; month: string; value: number };

function currentMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

export function ReturnRatePanel({ records }: { records: ReturnRateRecordDTO[] }) {
  const router = useRouter();
  const [month, setMonth] = useState(currentMonth());
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);

  const save = async () => {
    const num = Number(value);
    if (!month || value.trim() === "" || Number.isNaN(num) || num < 0 || num > 100) {
      setErr("Pon un mes y un porcentaje válido entre 0 y 100.");
      return;
    }
    setErr("");
    setBusy(true);
    const res = await fetch("/api/return-rate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ month, value: num }),
    });
    setBusy(false);
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setErr(data?.error ?? "No se pudo guardar.");
      return;
    }
    setValue("");
    router.refresh();
  };

  const remove = async (id: string) => {
    setBusy(true);
    await fetch(`/api/return-rate/${id}`, { method: "DELETE" });
    setBusy(false);
    setConfirmingDeleteId(null);
    router.refresh();
  };

  return (
    <div>
      <div className="bg-surface border border-rule rounded-md p-4.5 mb-5">
        <label className="block mb-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-steel">
          Agregar o actualizar un mes
        </label>
        <div className="flex items-end gap-2.5 flex-wrap">
          <div>
            <label className="block mb-1 text-[10px] text-steel">Mes</label>
            <input
              type="month"
              className="rounded border border-rule px-2.5 py-2 text-[13px] bg-surface"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
            />
          </div>
          <div>
            <label className="block mb-1 text-[10px] text-steel">Porcentaje de devolución</label>
            <div className="relative">
              <input
                type="number"
                step="0.1"
                min={0}
                max={100}
                className="w-32 rounded border border-rule px-2.5 py-2 text-[13px] pr-6"
                placeholder="Ej. 23.5"
                value={value}
                onChange={(e) => setValue(e.target.value)}
              />
              <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[12px] text-steel">%</span>
            </div>
          </div>
          <button
            type="button"
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded border border-blue bg-blue px-3.5 py-2 text-[12.5px] font-semibold text-white cursor-pointer disabled:opacity-60"
            onClick={save}
          >
            <Plus size={14} /> Guardar
          </button>
        </div>
        {err && <div className="text-red text-[12.5px] mt-2.5">{err}</div>}
        <div className="text-[11px] text-steel mt-2.5">
          Si el mes ya tiene un valor, guardar uno nuevo lo reemplaza.
        </div>
      </div>

      {records.length === 0 && (
        <div className="border-[1.5px] border-dashed border-rule rounded-md p-8.5 text-center text-steel text-[13.5px]">
          Aún no hay ningún mes cargado.
        </div>
      )}

      {records.map((r) => {
        const status = returnRateStatus(r.value);
        return (
          <div key={r.id} className="bg-surface border border-rule rounded p-3.5 mb-2.5 flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <span className="font-semibold text-[13.5px] w-16">{formatMonthShort(r.month)}</span>
              <span className="font-mono text-[13px]">{r.value}%</span>
              <span
                className="font-mono text-[10px] font-semibold tracking-wider px-2 py-0.5 rounded-full"
                style={{ color: status.color, border: `1px solid ${status.color}`, background: `${status.color}1a` }}
              >
                {status.label}
              </span>
            </div>
            {confirmingDeleteId === r.id ? (
              <div className="flex items-center gap-1.5">
                <button type="button" disabled={busy} className="text-red text-[11.5px] font-semibold cursor-pointer" onClick={() => remove(r.id)}>
                  Sí, eliminar
                </button>
                <button type="button" className="text-steel text-[11.5px] cursor-pointer" onClick={() => setConfirmingDeleteId(null)}>
                  Cancelar
                </button>
              </div>
            ) : (
              <button type="button" className="text-steel hover:text-red cursor-pointer" onClick={() => setConfirmingDeleteId(r.id)}>
                <Trash2 size={14} />
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
