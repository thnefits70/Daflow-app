"use client";

import { useEffect, useState } from "react";
import { WeeklyTrendChart, formatMonthShort } from "@/components/dashboard/WeeklyTrendChart";
import { PILLARS, generateAutoFeedback, type PillarKey } from "@/lib/recognition";
import { RecognitionPillarsInfo } from "@/components/recognition/RecognitionPillarsInfo";

type HistoryEntry = {
  month: string;
  userId: string;
  rank: number;
  outOf: number;
  totalScore: number;
  pillarScores: Record<string, number>;
  comment: string | null;
  hasDetail: boolean;
};

const MAX_PER_PILLAR = 20;

function scoreStatus(pct: number) {
  if (pct >= 80) return { label: "Excelente", color: "#14C7C7" };
  if (pct >= 60) return { label: "Bien", color: "#1E5EFF" };
  return { label: "A mejorar", color: "#D9A441" };
}

// The templates use "**palabra**" for emphasis — render those spans bold
// instead of showing the raw asterisks.
function renderBold(text: string) {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith("**") && part.endsWith("**") ? <strong key={i}>{part.slice(2, -2)}</strong> : <span key={i}>{part}</span>
  );
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
      <div>
        <RecognitionPillarsInfo />
        <div className="border-[1.5px] border-dashed border-rule rounded-md p-8.5 text-center text-steel text-[13.5px]">
          Todavía no tienes evaluaciones registradas — aparecerán aquí cuando tu líder evalúe tu desempeño del mes.
        </div>
      </div>
    );
  }

  const latest = history[history.length - 1];
  const pct = Math.round((latest.totalScore / maxTotalScore) * 100);
  const status = scoreStatus(pct);

  return (
    <div>
      <RecognitionPillarsInfo />

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
          {h.hasDetail ? (
            h.comment ? (
              <div className="text-[12.5px] italic bg-cloud rounded p-2.5 mb-2">&ldquo;{h.comment}&rdquo;</div>
            ) : (
              <div className="text-[12px] text-steel mb-2">Sin comentario ese mes.</div>
            )
          ) : (
            <div className="text-[11.5px] text-steel italic mb-2">El comentario de este mes ya no está disponible — solo se conserva el puntaje.</div>
          )}
          <div className="bg-teal/5 border border-teal/20 rounded p-2.5">
            <div className="text-[9.5px] font-semibold uppercase tracking-wide text-teal mb-1">🌱 Retroalimentación automática</div>
            <div className="text-[12px] text-steel leading-relaxed">
              {renderBold(generateAutoFeedback(h.userId, h.month, h.pillarScores as Record<PillarKey, number>))}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
