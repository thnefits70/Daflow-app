import { Clock } from "lucide-react";

export type ProcessUpdateDTO = { id: string; note: string; createdAt: string; ackedCount: number; teamSize: number };

export function ProcessHistoryPanel({ updates }: { updates: ProcessUpdateDTO[] }) {
  if (updates.length === 0) return null;

  return (
    <div className="mt-7">
      <h3 className="text-[14px] font-semibold mb-2.5 flex items-center gap-1.5">
        <Clock size={14} /> Historial de cambios
      </h3>
      <div className="space-y-2">
        {updates.map((u) => (
          <div key={u.id} className="bg-surface border border-rule rounded p-3.5">
            <div className="flex items-center justify-between gap-3 mb-1">
              <span className="font-mono text-[11px] text-steel">
                {new Date(u.createdAt).toLocaleDateString("es-MX", { day: "2-digit", month: "short", year: "numeric" })}
              </span>
              <span className="font-mono text-[10.5px] bg-cloud border border-rule rounded-full px-2 py-0.5 text-steel shrink-0">
                {u.ackedCount}/{u.teamSize} revisó
              </span>
            </div>
            <div className="text-[13px] text-ink/90">{u.note}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
