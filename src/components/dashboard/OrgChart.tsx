"use client";

import { useEffect, useRef, useState } from "react";
import { Award, User } from "lucide-react";
import type { DashboardRow } from "@/lib/dashboard";

function barColor(score: number) {
  if (score >= 75) return "#14C7C7";
  if (score >= 50) return "#1E5EFF";
  return "#C4453A";
}

export function OrgChart({ rowsSorted }: { rowsSorted: DashboardRow[] }) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const chartRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (chartRef.current && !chartRef.current.contains(e.target as Node)) setExpandedId(null);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  return (
    <div>
      <h3 className="text-[14px] font-semibold mb-1">Organigrama general</h3>
      <div className="text-[12px] text-steel mb-1">
        Ordenado de mejor a peor nivel de conocimiento — de izquierda a derecha. Toca un área para ver su equipo.
      </div>
      <div ref={chartRef} className="flex flex-col items-center gap-0 my-5">
        <div className="bg-navy text-white px-5.5 py-2.5 rounded font-display font-bold text-[13.5px] tracking-wide">
          PROVEDIX
        </div>
        <div className="w-[3px] h-5.5 bg-teal" />
        {rowsSorted.length > 0 && (
          <div
            className="grid gap-4 w-full max-w-4xl pt-5 mt-0.5 items-start"
            style={{ gridTemplateColumns: `repeat(auto-fit, minmax(150px, 1fr))`, borderTop: "1.5px dashed #D3DCE8" }}
          >
            {rowsSorted.map((r, i) => {
              const expanded = expandedId === r.dept.id;
              return (
                <div key={r.dept.id} className="flex flex-col items-center relative group">
                  <div className="absolute -top-5 left-1/2 -translate-x-1/2 w-[3px] h-5 bg-teal" />
                  <button
                    type="button"
                    onClick={() => setExpandedId(expanded ? null : r.dept.id)}
                    className={`bg-surface border rounded w-full text-center p-3 cursor-pointer ${
                      expanded ? "border-blue" : "border-rule"
                    }`}
                    style={{ borderTop: `3px solid ${r.avg !== null ? barColor(r.avg) : "#D3DCE8"}` }}
                  >
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="font-mono text-[10px] text-steel">#{i + 1}</span>
                      <span className="font-mono text-[9.5px] bg-cloud border border-rule rounded-full px-2 py-0.5">
                        {r.avg !== null ? `${r.avg}%` : "—"}
                      </span>
                    </div>
                    <div className="font-semibold text-[13px]" style={{ marginBottom: r.ranking.length ? 6 : 0 }}>
                      {r.dept.name}
                    </div>
                    {r.ranking.length > 0 && (
                      <div className="text-[10.5px] text-steel border-t border-rule pt-1.5">
                        🥇 {r.ranking[0].user} · {r.ranking[0].avg}%
                      </div>
                    )}
                  </button>

                  {expanded && (
                    <div className="w-full bg-surface border border-blue/40 rounded mt-1.5 p-2.5 text-left">
                      {r.members.length === 0 && (
                        <div className="text-[11px] text-steel text-center py-1">Sin personas asignadas.</div>
                      )}
                      {r.members.map((m) => (
                        <div key={m.id} className="flex items-center gap-2 py-1">
                          <div className="w-6 h-6 rounded-full overflow-hidden bg-cloud border border-rule flex items-center justify-center shrink-0">
                            {m.photoUrl ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={m.photoUrl} alt={m.name} className="w-full h-full object-cover object-top" />
                            ) : (
                              <User size={11} className="text-steel" />
                            )}
                          </div>
                          <div className="min-w-0">
                            <div className="text-[11.5px] font-medium truncate">{m.name}</div>
                            {m.position && <div className="text-[10px] text-steel truncate">{m.position}</div>}
                          </div>
                          {m.isLeader && (
                            <span className="ml-auto shrink-0 inline-flex items-center gap-1 font-mono text-[9px] bg-cloud border border-rule rounded-full px-1.5 py-0.5">
                              <Award size={9} /> Líder
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {r.leader?.photoUrl && (
                    <div className="absolute -top-2 -right-2 z-10">
                      <div className="w-7 h-7 rounded-full overflow-hidden border-2 border-navy bg-cloud cursor-pointer">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={r.leader.photoUrl} alt={r.leader.name} className="w-full h-full object-cover object-top" />
                      </div>
                      <div className="hidden group-hover:flex absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-20 flex-col items-center bg-surface border border-rule rounded-md p-2 shadow-lg">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={r.leader.photoUrl} alt={r.leader.name} className="w-20 h-20 rounded-md object-cover object-top mb-1.5" />
                        <span className="text-[11px] font-semibold whitespace-nowrap">{r.leader.name}</span>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
