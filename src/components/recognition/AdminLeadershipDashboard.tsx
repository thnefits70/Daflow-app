"use client";

import { useEffect, useState } from "react";
import { User } from "lucide-react";

type LeaderEntry = {
  evaluatorId: string;
  evaluatorName: string;
  photoUrl: string | null;
  score: number;
  answers: { questionText: string; score: number }[];
  positiveComment: string;
  improvementComment: string | null;
};
type Observation = { observerId: string; observerName: string; photoUrl: string | null; positiveComment: string; improvementComment: string | null };
type DashboardData = { month: string | null; leaderEntries: LeaderEntry[]; observations: Observation[] };

function formatMonthLabel(month: string) {
  const MONTH_ABBR = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
  const [y, m] = month.split("-");
  return `${MONTH_ABBR[Number(m) - 1]} ${y}`;
}

function Avatar({ photoUrl, name }: { photoUrl: string | null; name: string }) {
  return (
    <div className="w-9 h-9 rounded-full overflow-hidden bg-cloud border border-rule flex items-center justify-center shrink-0">
      {photoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={photoUrl} alt={name} className="w-full h-full object-cover" />
      ) : (
        <User size={15} className="text-steel" />
      )}
    </div>
  );
}

// Tablero privado del admin — feedback de Liderazgo 360° recibido de los 5
// líderes (con nota) + observaciones del resto de la empresa (sin nota).
// Nunca toca ranking ni Colaborador del Mes: se lee directo de
// AdminLeadershipFeedback/AdminLeadershipObservation. Solo se ve por mes ya
// confirmado (mismo criterio que el resto del feedback de equipo).
export function AdminLeadershipDashboard() {
  const [month, setMonth] = useState<string | null>(null);
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const url = month ? `/api/recognition/admin-feedback?month=${month}` : "/api/recognition/admin-feedback";
    fetch(url)
      .then((res) => res.json())
      .then((d: DashboardData) => {
        setData(d);
        setMonth(d.month);
      })
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month]);

  return (
    <div>
      <div className="text-[13px] text-steel mb-4 max-w-2xl">
        Feedback privado de tu propio Liderazgo — de los 5 líderes (con nota) y de cualquier otra persona de la
        empresa (solo comentarios). Nunca entra al ranking de Colaborador Destacado. Aparece por mes recién cuando
        confirmas el podio de ese mes.
      </div>

      {month && (
        <div className="bg-surface border border-rule rounded-md p-3.5 mb-4 flex items-center gap-3 flex-wrap">
          <label className="text-[11px] font-semibold uppercase tracking-wide text-steel">Mes</label>
          <input
            type="month"
            className="rounded border border-rule px-2.5 py-1.5 text-[13px] bg-surface"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
          />
          <span className="text-[12px] text-steel">{formatMonthLabel(month)}</span>
        </div>
      )}

      {loading && <div className="text-[13px] text-steel">Cargando…</div>}

      {!loading && !month && (
        <div className="border-[1.5px] border-dashed border-rule rounded-md p-8.5 text-center text-steel text-[13.5px]">
          Todavía no hay ningún mes confirmado — este feedback aparece recién cuando confirmas el podio de un mes.
        </div>
      )}

      {!loading && data && month && (
        <>
          <div className="mb-6">
            <div className="text-[12px] font-semibold uppercase tracking-wide text-steel mb-2.5">De tus líderes</div>
            {data.leaderEntries.length === 0 && <div className="text-[12.5px] text-steel">Nadie te calificó ese mes.</div>}
            {data.leaderEntries.map((e) => (
              <div key={e.evaluatorId} className="bg-surface border border-rule rounded-md p-4 mb-3">
                <div className="flex items-center justify-between gap-3 flex-wrap mb-2.5">
                  <div className="flex items-center gap-2.5">
                    <Avatar photoUrl={e.photoUrl} name={e.evaluatorName} />
                    <span className="font-semibold text-[13px]">{e.evaluatorName}</span>
                  </div>
                  <span className="font-mono text-[12.5px] font-semibold">{e.score}/20</span>
                </div>
                <div className="text-[12.5px] italic bg-cloud rounded p-2.5 mb-2">&ldquo;{e.positiveComment}&rdquo;</div>
                {e.improvementComment && (
                  <div className="text-[12.5px] italic bg-gold/10 border border-gold/30 rounded p-2.5">&ldquo;{e.improvementComment}&rdquo;</div>
                )}
              </div>
            ))}
          </div>

          <div>
            <div className="text-[12px] font-semibold uppercase tracking-wide text-steel mb-2.5">Del resto de la empresa</div>
            {data.observations.length === 0 && <div className="text-[12.5px] text-steel">Nadie más dejó una observación ese mes.</div>}
            {data.observations.map((o) => (
              <div key={o.observerId} className="bg-surface border border-rule rounded-md p-4 mb-3">
                <div className="flex items-center gap-2.5 mb-2.5">
                  <Avatar photoUrl={o.photoUrl} name={o.observerName} />
                  <span className="font-semibold text-[13px]">{o.observerName}</span>
                </div>
                <div className="text-[12.5px] italic bg-cloud rounded p-2.5 mb-2">&ldquo;{o.positiveComment}&rdquo;</div>
                {o.improvementComment && (
                  <div className="text-[12.5px] italic bg-gold/10 border border-gold/30 rounded p-2.5">&ldquo;{o.improvementComment}&rdquo;</div>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
