"use client";

import { useEffect, useState } from "react";
import { User, Award, ChevronDown, ChevronUp } from "lucide-react";
import { PILLARS } from "@/lib/recognition";

type RankedPersonDTO = {
  rank: number;
  userId: string;
  name: string;
  photoUrl: string | null;
  deptName: string | null;
  isLeader: boolean;
  totalScore: number;
  pillarScores: Record<string, number>;
  comment: string | null;
  answers: { pillar: string; questionId: string; questionText: string; score: number }[];
  hasDetail: boolean;
};

const MEDAL = ["🥇", "🥈", "🥉"];
const MAX_PER_PILLAR = 20; // QUESTIONS_PER_PILLAR (4) * MAX_SCORE_PER_QUESTION (5)

function formatMonthLabel(month: string) {
  const MONTH_ABBR = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
  const [y, m] = month.split("-");
  return `${MONTH_ABBR[Number(m) - 1]} ${y}`;
}

export function RecognitionRanking({
  scope,
  departments,
}: {
  scope: "admin" | "leader";
  departments?: { id: string; name: string }[];
}) {
  const [month, setMonth] = useState<string | null>(null);
  const [deptId, setDeptId] = useState("");
  const [months, setMonths] = useState<string[]>([]);
  const [maxTotalScore, setMaxTotalScore] = useState(140);
  const [ranked, setRanked] = useState<RankedPersonDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams();
    if (month) params.set("month", month);
    if (deptId) params.set("deptId", deptId);
    fetch(`/api/recognition/ranking?${params.toString()}`)
      .then((res) => res.json())
      .then((d) => {
        setMonth(d.month);
        setMonths(d.months);
        setMaxTotalScore(d.maxTotalScore);
        setRanked(d.ranked);
      })
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deptId]);

  const changeMonth = (m: string) => {
    setLoading(true);
    setMonth(m);
    const params = new URLSearchParams({ month: m });
    if (deptId) params.set("deptId", deptId);
    fetch(`/api/recognition/ranking?${params.toString()}`)
      .then((res) => res.json())
      .then((d) => setRanked(d.ranked))
      .finally(() => setLoading(false));
  };

  return (
    <div>
      <div className="flex items-center gap-3 mb-5 flex-wrap">
        {month && months.length > 0 && (
          <select
            className="rounded border border-rule px-2.5 py-2 text-[13px] bg-surface"
            value={month}
            onChange={(e) => changeMonth(e.target.value)}
          >
            {months.map((m) => (
              <option key={m} value={m}>{formatMonthLabel(m)}</option>
            ))}
          </select>
        )}
        {scope === "admin" && departments && (
          <select
            className="rounded border border-rule px-2.5 py-2 text-[13px] bg-surface"
            value={deptId}
            onChange={(e) => setDeptId(e.target.value)}
          >
            <option value="">Todas las áreas</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
        )}
      </div>

      {loading && <div className="text-[13px] text-steel">Cargando ranking…</div>}

      {!loading && ranked.length === 0 && (
        <div className="border-[1.5px] border-dashed border-rule rounded-md p-8.5 text-center text-steel text-[13.5px]">
          Todavía no hay evaluaciones para este mes.
        </div>
      )}

      {!loading &&
        ranked.map((p) => {
          const expanded = expandedId === p.userId;
          return (
            <div key={p.userId} className="bg-surface border border-rule rounded-md mb-2.5 overflow-hidden">
              <button
                type="button"
                className="w-full flex items-center gap-3 p-3.5 cursor-pointer text-left"
                onClick={() => setExpandedId(expanded ? null : p.userId)}
              >
                <span className="font-display text-[16px] font-bold w-8 text-center shrink-0">
                  {p.rank <= 3 ? MEDAL[p.rank - 1] : `#${p.rank}`}
                </span>
                <div className="w-9 h-9 rounded-full overflow-hidden bg-cloud border border-rule flex items-center justify-center shrink-0">
                  {p.photoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={p.photoUrl} alt={p.name} className="w-full h-full object-cover" />
                  ) : (
                    <User size={16} className="text-steel" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="font-semibold text-[13.5px] truncate">{p.name}</span>
                    {p.isLeader && (
                      <span className="inline-flex items-center gap-1 font-mono text-[9px] bg-cloud border border-rule rounded-full px-1.5 py-0.5 shrink-0">
                        <Award size={9} /> Líder
                      </span>
                    )}
                  </div>
                  <div className="text-[11.5px] text-steel truncate">{p.deptName}</div>
                </div>
                <span className="font-mono text-[13px] shrink-0">{p.totalScore} / {maxTotalScore}</span>
                {expanded ? <ChevronUp size={15} className="shrink-0" /> : <ChevronDown size={15} className="shrink-0" />}
              </button>

              {expanded && (
                <div className="border-t border-rule p-4">
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 mb-4">
                    {PILLARS.map((pillar) => {
                      const score = p.pillarScores[pillar.key] ?? 0;
                      const pct = Math.round((score / MAX_PER_PILLAR) * 100);
                      return (
                        <div key={pillar.key} className="bg-cloud rounded p-2.5">
                          <div className="text-[10px] font-semibold uppercase tracking-wide text-steel mb-1">{pillar.label}</div>
                          <div className="font-mono text-[13px] font-semibold">{score}/{MAX_PER_PILLAR}</div>
                          <div className="w-full h-1 bg-rule rounded-full overflow-hidden mt-1">
                            <div className="h-full bg-blue rounded-full" style={{ width: `${pct}%` }} />
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {p.comment && (
                    <div className="bg-cloud rounded p-3 mb-4 text-[12.5px] italic">&ldquo;{p.comment}&rdquo;</div>
                  )}

                  {p.hasDetail ? (
                    <>
                      <div className="text-[10.5px] font-semibold uppercase tracking-wide text-steel mb-2">Detalle por pregunta</div>
                      <div className="space-y-1.5">
                        {p.answers.map((a) => (
                          <div key={a.questionId} className="flex items-center justify-between gap-3 text-[12px]">
                            <span className="text-steel flex-1">{a.questionText}</span>
                            <span className="font-mono font-semibold shrink-0">{a.score}/5</span>
                          </div>
                        ))}
                      </div>
                    </>
                  ) : (
                    <div className="text-[11.5px] text-steel italic">
                      El detalle pregunta por pregunta y el comentario de este mes ya no están disponibles — solo se conserva el puntaje.
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
    </div>
  );
}
