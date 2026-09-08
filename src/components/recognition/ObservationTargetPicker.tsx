"use client";

import { useEffect, useState } from "react";
import { User } from "lucide-react";
import { LeaderObservationForm } from "@/components/recognition/LeaderObservationForm";

type LeaderOption = { id: string; name: string; photoUrl: string | null; deptName: string | null };

// Deja elegir a quién dejarle la observación: cualquier líder que no sea el
// propio (a ese se le califica directo con LeadershipQuestionsForm), o el
// admin.
export function ObservationTargetPicker() {
  const [leaders, setLeaders] = useState<LeaderOption[] | null>(null);
  const [target, setTarget] = useState<{ type: "leader" | "admin"; id: string; name: string } | null>(null);

  useEffect(() => {
    fetch("/api/recognition/observable-leaders")
      .then((res) => res.json())
      .then((d) => setLeaders(d.leaders ?? []));
  }, []);

  if (target) {
    return (
      <div>
        <button type="button" className="text-[12.5px] text-steel hover:text-ink cursor-pointer mb-4" onClick={() => setTarget(null)}>
          ← Elegir otra persona
        </button>
        <LeaderObservationForm
          key={target.id}
          fetchUrl={target.type === "admin" ? "/api/recognition/admin-observation" : `/api/recognition/leader-observation?leaderId=${target.id}`}
          submitUrl={target.type === "admin" ? "/api/recognition/admin-observation" : "/api/recognition/leader-observation"}
          extraBody={target.type === "leader" ? { leaderId: target.id } : undefined}
          targetName={target.name}
        />
      </div>
    );
  }

  if (leaders === null) return <div className="text-[13px] text-steel">Cargando…</div>;

  return (
    <div>
      <div className="text-[12.5px] text-steel mb-3">Elige a quién quieres dejarle una observación este mes.</div>
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
        {leaders.map((l) => (
          <button
            key={l.id}
            type="button"
            onClick={() => setTarget({ type: "leader", id: l.id, name: l.name })}
            className="bg-surface border border-rule rounded p-4 text-left hover:border-blue cursor-pointer flex items-center gap-2.5"
          >
            <div className="w-10 h-10 rounded-full overflow-hidden bg-cloud border border-rule flex items-center justify-center shrink-0">
              {l.photoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={l.photoUrl} alt={l.name} className="w-full h-full object-cover" />
              ) : (
                <User size={16} className="text-steel" />
              )}
            </div>
            <div className="min-w-0">
              <div className="font-semibold text-[13px] truncate">{l.name}</div>
              <div className="text-[11px] text-steel truncate">{l.deptName || ""}</div>
            </div>
          </button>
        ))}
        <button
          type="button"
          onClick={() => setTarget({ type: "admin", id: "admin", name: "el admin" })}
          className="bg-surface border border-rule rounded p-4 text-left hover:border-blue cursor-pointer flex items-center gap-2.5"
        >
          <div className="w-10 h-10 rounded-full overflow-hidden bg-cloud border border-rule flex items-center justify-center shrink-0">
            <User size={16} className="text-steel" />
          </div>
          <div className="min-w-0">
            <div className="font-semibold text-[13px] truncate">Admin</div>
            <div className="text-[11px] text-steel truncate">Dirección general</div>
          </div>
        </button>
      </div>
    </div>
  );
}
