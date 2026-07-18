"use client";

import { useEffect, useState } from "react";
import { WeeklyTrendChart, formatMonthShort } from "@/components/dashboard/WeeklyTrendChart";
import { PILLARS } from "@/lib/recognition";

type HistoryEntry = {
  month: string;
  rank: number;
  outOf: number;
  totalScore: number;
  pillarScores: Record<string, number>;
  comment: string | null;
};

const MAX_PER_PILLAR = 20;

function scoreStatus(pct: number) {
  if (pct >= 80) return { label: "Excelente", color: "#14C7C7" };
  if (pct >= 60) return { label: "Bien", color: "#1E5EFF" };
  return { label: "A mejorar", color: "#D9A441" };
}

export function RecognitionMyProgress() {
  const [history, setHistory] = useState<HistoryEntry[] | null>(null);
  const [maxTotalScore, setMaxTotalScore] = useState(140);

  useEffect(() => {
    fetch("/api/recognition/my-progress")
      .then((res) => res.json())
      .then((d) => {
        setHistory(d.history);
        setMaxTotalScore(d.maxTotalScore);
      });
  }, []);

  if (history === null) return <div className="text-[13px] text-steel">Cargando…</div>;

  if (history.length === 0) {
    return (
      <div className="border-[1.5px] border-dashed border-rule rounded-md p-8.5 text-center text-steel text-[13.5px]">
        Todavía no tienes evaluaciones registradas — aparecerán aquí cuando tu líder evalúe tu desempeño del mes.
      </div>
    );
  }

  const latest = history[history.length - 1];
  const pct = Math.round((latest.totalScore / maxTotalScore) * 100);
  const status = scoreStatus(pct);

  return (
    <div>
      <div className="bg-surface border border-rule rounded-lg p-6 mb-6">
        <WeeklyTrendChart
          label="Tu puntaje mensual"
          deptName="Colaborador Destacado"
          points={history.map((h) => ({ week: h.month, value: h.totalScore }))}
          periodLabel={formatMonthShort}
          latestLabel="último mes"
          statusFn={(v) => scoreStatus(Math.round((v / maxTotalScore) * 100))}
        />
      </div>

      <div className="flex items-center gap-2.5 mb-4">
        <span
          className="font-mono text-[10.5px] font-semibold tracking-wider px-2.5 py-1 rounded-full"
          style={{ color: status.color, border: `1px solid ${status.color}`, background: `${status.color}1a` }}
        >
          {status.label}
        </span>
        <span className="text-[12.5px] text-steel">
          Puesto #{latest.rank} de {latest.outOf} este mes
        </span>
      </div>

      {[...history].reverse().map((h) => (
        <div key={h.month} className="bg-surface border border-rule rounded p-4 mb-3">
          <div className="flex items-center justify-between gap-3 mb-2.5 flex-wrap">
            <span className="font-semibold text-[13.5px]">{formatMonthShort(h.month)}</span>
            <span className="text-[12px] text-steel">
              Puesto #{h.rank} de {h.outOf} · {h.totalScore}/{maxTotalScore}
            </span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-2.5">
            {PILLARS.map((pillar) => (
              <div key={pillar.key} className="bg-cloud rounded px-2.5 py-1.5">
                <div className="text-[9.5px] uppercase tracking-wide text-steel">{pillar.label}</div>
                <div className="font-mono text-[12px] font-semibold">{h.pillarScores[pillar.key] ?? 0}/{MAX_PER_PILLAR}</div>
              </div>
            ))}
          </div>
          {h.comment ? (
            <div className="text-[12.5px] italic bg-cloud rounded p-2.5">&ldquo;{h.comment}&rdquo;</div>
          ) : (
            <div className="text-[12px] text-steel">Sin comentario ese mes.</div>
          )}
        </div>
      ))}
    </div>
  );
}
