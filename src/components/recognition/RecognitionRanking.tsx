"use client";

import { useEffect, useState } from "react";
import { User, Award, ChevronDown, ChevronUp, Trophy } from "lucide-react";
import { PILLARS, generateAutoFeedback, type PillarKey } from "@/lib/recognition";

// The templates use "**palabra**" for emphasis — render those spans bold
// instead of showing the raw asterisks.
function renderBold(text: string) {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith("**") && part.endsWith("**") ? <strong key={i}>{part.slice(2, -2)}</strong> : <span key={i}>{part}</span>
  );
}

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

type ConfirmedPodiumEntry = { rank: number; userId: string; name: string; photoUrl: string | null; totalScore: number };

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
  const [canConfirm, setCanConfirm] = useState(false);
  const [confirmedPodium, setConfirmedPodium] = useState<ConfirmedPodiumEntry[]>([]);
  const [confirmingWinner, setConfirmingWinner] = useState(false);
  const [busy, setBusy] = useState(false);

  const applyResponse = (d: {
    month: string;
    months: string[];
    maxTotalScore: number;
    ranked: RankedPersonDTO[];
    canConfirm: boolean;
    confirmedPodium: ConfirmedPodiumEntry[];
  }) => {
    setMonth(d.month);
    setMonths(d.months);
    setMaxTotalScore(d.maxTotalScore);
    setRanked(d.ranked);
    setCanConfirm(d.canConfirm);
    setConfirmedPodium(d.confirmedPodium);
  };

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams();
    if (month) params.set("month", month);
    if (deptId) params.set("deptId", deptId);
    fetch(`/api/recognition/ranking?${params.toString()}`)
      .then((res) => res.json())
      .then(applyResponse)
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
      .then(applyResponse)
      .finally(() => setLoading(false));
  };

  const confirmWinner = async () => {
    if (!month) return;
    setBusy(true);
    const res = await fetch("/api/recognition/confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ month }),
    });
    setBusy(false);
    setConfirmingWinner(false);
    if (res.ok) {
      const data = await res.json();
      setConfirmedPodium(data.podium.map((p: { rank: number; userId: string; totalScore: number }) => {
        const person = ranked.find((r) => r.userId === p.userId);
        return { rank: p.rank, userId: p.userId, name: person?.name ?? "", photoUrl: person?.photoUrl ?? null, totalScore: p.totalScore };
      }));
    }
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

      {!loading && confirmedPodium.length > 0 && (
        <div className="bg-teal/10 border border-teal rounded-md p-4 mb-5 flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2.5">
            <Trophy size={18} className="text-teal shrink-0" />
            <div>
              <div className="text-[13px] font-semibold">
                Podio confirmado — {confirmedPodium.find((p) => p.rank === 1)?.name} es el Colaborador Destacado de {formatMonthLabel(month ?? "")}
              </div>
              <div className="text-[11.5px] text-steel">
                {confirmedPodium.map((p) => `${MEDAL[p.rank - 1]} ${p.name}`).join("  ·  ")}
              </div>
            </div>
          </div>
          {canConfirm &&
            (confirmingWinner ? (
              <span className="flex items-center gap-2 text-[12px] shrink-0">
                <span className="text-steel">¿Volver a confirmar con el ranking actual?</span>
                <button type="button" disabled={busy} className="text-teal font-semibold cursor-pointer" onClick={confirmWinner}>Sí</button>
                <button type="button" className="text-steel cursor-pointer" onClick={() => setConfirmingWinner(false)}>Cancelar</button>
              </span>
            ) : (
              <button type="button" className="text-[12px] text-steel hover:text-ink cursor-pointer underline underline-offset-2 shrink-0" onClick={() => setConfirmingWinner(true)}>
                Volver a confirmar
              </button>
            ))}
        </div>
      )}

      {!loading && confirmedPodium.length === 0 && canConfirm && ranked.length > 0 && (
        <div className="bg-surface border border-rule rounded-md p-4 mb-5 flex items-center justify-between gap-3 flex-wrap">
          <div className="text-[12.5px] text-steel">
            Este mes todavía no tiene un Colaborador Destacado confirmado.
          </div>
          {confirmingWinner ? (
            <span className="flex items-center gap-2 text-[12px] shrink-0">
              <span className="text-steel">¿Confirmar a {ranked[0]?.name} como Colaborador Destacado de {formatMonthLabel(month ?? "")}?</span>
              <button type="button" disabled={busy} className="rounded border border-teal bg-teal px-3 py-1.5 text-[12px] font-semibold text-white cursor-pointer disabled:opacity-60" onClick={confirmWinner}>
                Sí, confirmar
              </button>
              <button type="button" className="text-steel cursor-pointer" onClick={() => setConfirmingWinner(false)}>Cancelar</button>
            </span>
          ) : (
            <button
              type="button"
              className="inline-flex items-center gap-1.5 rounded border border-teal bg-teal px-3.5 py-2 text-[12.5px] font-semibold text-white cursor-pointer shrink-0"
              onClick={() => setConfirmingWinner(true)}
            >
              <Trophy size={14} /> Confirmar Colaborador Destacado
            </button>
          )}
        </div>
      )}

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
                    <div className="bg-cloud rounded p-3 mb-3 text-[12.5px] italic">&ldquo;{p.comment}&rdquo;</div>
                  )}

                  <div className="bg-teal/5 border border-teal/20 rounded p-3 mb-4">
                    <div className="text-[9.5px] font-semibold uppercase tracking-wide text-teal mb-1">🌱 Retroalimentación automática</div>
                    <div className="text-[12px] text-steel leading-relaxed">
                      {renderBold(generateAutoFeedback(p.userId, month ?? "", p.pillarScores as Record<PillarKey, number>))}
                    </div>
                  </div>

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
