"use client";

import { useState } from "react";
import { Award, X } from "lucide-react";

type Alert = { id: string; processTitle: string; pendingCount: number; teamSize: number };

export function LeaderBanner({ deptName, alerts }: { deptName: string; alerts: Alert[] }) {
  const [hidden, setHidden] = useState(false);
  if (hidden || alerts.length === 0) return null;

  return (
    <div className="bg-white border border-rule rounded p-4.5 mb-5" style={{ borderLeft: "4px solid #1E5EFF", background: "#FFF7EA" }}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="font-bold text-[13.5px] flex items-center gap-1.5 mb-1">
            <Award size={14} /> Aviso para ti como líder de {deptName}
          </div>
          {alerts.map((a) => (
            <div key={a.id} className="text-[12.5px] text-steel mt-0.5">
              &quot;{a.processTitle}&quot; — {a.pendingCount} de {a.teamSize} personas de tu equipo aún no lo han
              revisado. Avísales directamente si no tienen acceso constante a computadora.
            </div>
          ))}
        </div>
        <button type="button" className="text-steel hover:text-navy cursor-pointer shrink-0" onClick={() => setHidden(true)}>
          <X size={16} />
        </button>
      </div>
    </div>
  );
}
