"use client";

import { useState } from "react";
import { BellRing, Check } from "lucide-react";

type DueReminder = {
  id: string;
  deptId: string;
  deptName: string;
  title: string;
  detail: string;
  recurrence: "DAILY" | "WEEKLY" | "ONCE";
  timeOfDay: string | null;
  period: string;
};

// Confirmed 2026-07-23: shows only what's genuinely due right now (see
// getDuePeriodicReminders in src/lib/periodicReminders.ts) so it reads as
// "what do I need to do today," not the full catalog — that full list with
// history lives in each área's Recordatorios tab. Marking one done here
// removes it from this card immediately; the detail stays in the tab.
export function PeriodicRemindersCard({ items, showDept = false }: { items: DueReminder[]; showDept?: boolean }) {
  const [visible, setVisible] = useState(items);
  const [busyId, setBusyId] = useState<string | null>(null);

  if (visible.length === 0) return null;

  const complete = async (r: DueReminder) => {
    setBusyId(r.id);
    await fetch(`/api/periodic-reminders/${r.id}/complete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ period: r.period }),
    }).catch(() => {});
    setBusyId(null);
    setVisible((v) => v.filter((x) => x.id !== r.id));
  };

  return (
    <div className="bg-surface border rounded-lg p-4 mb-6" style={{ borderColor: "rgba(20,199,199,.35)" }}>
      <div className="flex items-center justify-between gap-3 mb-0.5">
        <div className="flex items-center gap-2 text-[13px] font-bold">
          <BellRing size={14} className="text-teal" />
          Recordatorios de hoy
        </div>
        <span
          className="font-mono text-[10.5px] font-bold rounded-full px-2.5 py-0.5 border"
          style={{ color: "#14C7C7", background: "rgba(20,199,199,.1)", borderColor: "rgba(20,199,199,.35)" }}
        >
          {visible.length} pendiente{visible.length === 1 ? "" : "s"}
        </span>
      </div>
      <div className="text-[11px] text-steel mb-3">Se marcan como hechas aquí mismo — el detalle completo queda en Recordatorios de cada área.</div>

      <div className="flex flex-col gap-1.5">
        {visible.map((r) => (
          <div key={r.id} className="flex items-center gap-2.5 rounded-md px-3 py-2.5 bg-cloud">
            <span className="text-[14px] w-5 text-center shrink-0">⏰</span>
            <div className="flex-1 min-w-0">
              <div className="text-[12.5px] font-semibold">{r.title}</div>
              <div className="text-[10.5px] mt-0.5 text-steel">
                {showDept && <>{r.deptName} · </>}
                {r.recurrence === "DAILY" ? "Diario" : r.recurrence === "WEEKLY" ? "Semanal" : "Una vez"}
                {r.timeOfDay && <> · {r.timeOfDay}</>}
                {r.detail && <> · {r.detail}</>}
              </div>
            </div>
            <button
              type="button"
              disabled={busyId === r.id}
              className="inline-flex items-center gap-1 text-[11px] font-bold text-white bg-teal rounded-full px-2.5 py-1 cursor-pointer disabled:opacity-60 shrink-0"
              onClick={() => complete(r)}
            >
              <Check size={11} /> Realizado
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
