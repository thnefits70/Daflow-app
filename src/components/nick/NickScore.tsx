"use client";

import { useEffect, useState } from "react";
import type { NickScore as Score } from "@/lib/nick/score";

// NICK Etapa 3 (2026-10-16): marcador de 100 puntos, solo el admin.
// Se habla de "puntos" (pedido del usuario: nunca "peso" ni "nota").

const COLOR = {
  VERDE: { text: "Va bien", cls: "text-green", ring: "border-green", bg: "bg-green" },
  AMARILLO: { text: "Hay que mejorar", cls: "text-amber", ring: "border-amber", bg: "bg-amber" },
  ROJO: { text: "Algo está fallando", cls: "text-red", ring: "border-red", bg: "bg-red" },
} as const;

const usd = (n: number) => `$${n.toLocaleString("es-EC")}`;

function Trend({ points }: { points: { day: string; score: number | null }[] }) {
  const pts = points.filter((p) => p.score != null) as { day: string; score: number }[];
  if (pts.length < 2) return <div className="text-[12px] text-steel">La tendencia aparece desde el segundo día (se guarda un marcador por día).</div>;
  const W = 640;
  const H = 140;
  const x = (i: number) => 20 + (i * (W - 40)) / (pts.length - 1);
  const y = (s: number) => H - 20 - (s / 100) * (H - 40);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-[150px]">
      {[70, 85].map((t) => (
        <g key={t}>
          <line x1={20} x2={W - 20} y1={y(t)} y2={y(t)} className="stroke-rule" strokeDasharray="4 4" />
          <text x={W - 18} y={y(t) + 3} className="fill-steel text-[9px]">
            {t}
          </text>
        </g>
      ))}
      <polyline fill="none" className="stroke-blue" strokeWidth={2} points={pts.map((p, i) => `${x(i)},${y(p.score)}`).join(" ")} />
      {pts.map((p, i) => (
        <circle key={p.day} cx={x(i)} cy={y(p.score)} r={3} className="fill-blue">
          <title>{`${p.day}: ${p.score} puntos`}</title>
        </circle>
      ))}
      <text x={20} y={H - 4} className="fill-steel text-[9px]">
        {pts[0].day}
      </text>
      <text x={W - 20} y={H - 4} textAnchor="end" className="fill-steel text-[9px]">
        {pts[pts.length - 1].day}
      </text>
    </svg>
  );
}

export function NickScore() {
  const [data, setData] = useState<Score | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    fetch("/api/nick/score")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d: Score) => setData(d))
      .catch(() => setError("No se pudo calcular el marcador. Intenta de nuevo en un momento."));
  };
  useEffect(load, []);

  if (error) return <div className="p-5 text-[12px] text-red">{error}</div>;
  if (!data) return <div className="p-5 text-[12px] text-steel">Calculando el marcador… (tarda unos segundos)</div>;

  const c = data.color ? COLOR[data.color] : null;
  return (
    <div className="mb-8 flex flex-col gap-4">
      <div className="font-mono text-[10.5px] tracking-[.14em] uppercase text-steel">Marcador de la operación · solo lo ves tú</div>

      <div className="bg-surface border border-rule rounded-lg p-5 flex flex-wrap items-center gap-6">
        <div className={`w-[130px] h-[130px] rounded-full border-[10px] ${c?.ring ?? "border-rule"} flex flex-col items-center justify-center`}>
          <div className="font-display text-[34px] font-bold tabular-nums leading-none">{data.score ?? "—"}</div>
          <div className="text-[11px] text-steel mt-1">de 100 puntos</div>
        </div>
        <div className="min-w-[220px] flex-1">
          {c && <div className={`font-display text-[20px] font-bold ${c.cls}`}>{c.text}</div>}
          <div className="text-[12px] text-steel mt-1">🟢 85 a 100 puntos: va bien · 🟡 70 a 84: hay que mejorar · 🔴 menos de 70: algo está fallando</div>
          {data.provisional && (
            <div className="text-[11.5px] text-amber mt-2">
              Provisional: algunas partes todavía se empiezan a medir, así que el total se calcula solo con las que ya tienen datos.
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {data.parts.map((p) => (
          <div key={p.key} className="bg-surface border border-rule rounded-lg p-4">
            <div className="flex items-baseline justify-between gap-2">
              <div className="text-[13px] font-semibold">{p.label}</div>
              <div className="text-[11px] text-steel">da hasta {p.max} puntos</div>
            </div>
            <div className="font-display text-[24px] font-bold tabular-nums mt-1">
              {p.points == null ? <span className="text-steel text-[14px]">Se empieza a medir</span> : `${p.points} de ${p.max} puntos`}
            </div>
            {p.pct != null && (
              <div className="h-1.5 rounded-full bg-rule mt-2 overflow-hidden">
                <div className="h-full bg-blue" style={{ width: `${Math.round(p.pct * 100)}%` }} />
              </div>
            )}
            <div className="text-[11px] text-steel mt-2">{p.detail}</div>
          </div>
        ))}
      </div>

      <div className="bg-surface border border-rule rounded-lg p-4">
        <div className="text-[13px] font-semibold mb-2">Resumen · últimos 30 días</div>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 text-[12px]">
          <div>
            <div className="text-steel">Pedidos</div>
            <div className="font-display text-[20px] font-bold tabular-nums">{data.summary.guides.toLocaleString("es-EC")}</div>
          </div>
          <div>
            <div className="text-steel">Entregados</div>
            <div className="font-display text-[20px] font-bold tabular-nums text-green">{data.summary.deliveredPct}%</div>
          </div>
          <div>
            <div className="text-steel">Devueltos</div>
            <div className="font-display text-[20px] font-bold tabular-nums text-red">{data.summary.returnedPct}%</div>
          </div>
          <div>
            <div className="text-steel">En camino</div>
            <div className="font-display text-[20px] font-bold tabular-nums">{data.summary.inTransit.toLocaleString("es-EC")}</div>
          </div>
          <div>
            <div className="text-steel">Con novedad</div>
            <div className="font-display text-[20px] font-bold tabular-nums">{data.summary.novelty.toLocaleString("es-EC")}</div>
          </div>
        </div>
      </div>

      {data.money && (
        <div className="bg-surface border border-rule rounded-lg p-4">
          <div className="text-[13px] font-semibold mb-2">Impacto en dinero · solo lo ves tú</div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-[12px]">
            <div className="rounded-md border border-amber/40 bg-amber/5 p-3">
              <div className="text-steel">💰 Dinero en riesgo</div>
              <div className="font-display text-[22px] font-bold tabular-nums text-amber">{usd(data.money.atRisk)}</div>
              <div className="text-[11px] text-steel">Lo que pagaría Dropi por {data.money.atRiskGuides} guías estancadas o con novedad</div>
            </div>
            <div className="rounded-md border border-red/40 bg-red/5 p-3">
              <div className="text-steel">📦 Mercadería que no volvió</div>
              <div className="font-display text-[22px] font-bold tabular-nums text-red">{usd(data.money.lost)}</div>
              <div className="text-[11px] text-steel">Costo de {data.money.lostGuides} devoluciones sin escanear en Reingresos</div>
            </div>
            <div className="rounded-md border border-green/40 bg-green/5 p-3">
              <div className="text-steel">✅ Mercadería recuperada</div>
              <div className="font-display text-[22px] font-bold tabular-nums text-green">{usd(data.money.recovered)}</div>
              <div className="text-[11px] text-steel">Costo de {data.money.recoveredGuides} devoluciones que sí volvieron</div>
            </div>
          </div>
          {data.money.missingPrices > 0 && (
            <div className="text-[10.5px] text-steel mt-2">{data.money.missingPrices} guías no suman porque su producto no tiene precio o costo en el catálogo (combos o productos sin compra).</div>
          )}
        </div>
      )}

      <div className="bg-surface border border-rule rounded-lg p-4">
        <div className="text-[13px] font-semibold mb-2">Tendencia del marcador</div>
        <Trend points={data.trend} />
      </div>

      {data.recommendations.length > 0 && (
        <div className="bg-surface border border-rule rounded-lg p-4">
          <div className="text-[13px] font-semibold mb-2">Recomendaciones</div>
          <ul className="flex flex-col gap-1.5 text-[12.5px]">
            {data.recommendations.map((r) => (
              <li key={r} className="flex gap-2">
                <span className="text-blue">→</span>
                <span>{r}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
