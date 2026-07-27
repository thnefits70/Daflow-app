"use client";

import { useEffect, useState } from "react";

// Confirmado 2026-07-27: escala de 1 a 10 (score sigue llegando como 0-100
// internamente, solo se muestra /10) con 4 bandas — <5 riesgo, 5-8 regular,
// 8-9 muy bueno (verde), 9-10 excelente (con el anillo brillante girando).
function scoreColor(score: number) {
  if (score >= 90) return "#14C7C7"; // excelente
  if (score >= 80) return "#22C55E"; // muy bueno
  if (score >= 50) return "#1E5EFF"; // regular
  return "#C4453A"; // riesgo
}

function scoreLabel(score: number) {
  if (score >= 90) return "EXCELENTE";
  if (score >= 80) return "MUY BUENO";
  if (score >= 50) return "REGULAR";
  return "RIESGO";
}

export function ScoreGauge({ score, size = 150 }: { score: number | null; size?: number }) {
  const [reducedMotion, setReducedMotion] = useState(false);
  useEffect(() => {
    setReducedMotion(window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }, []);

  const value = score ?? 0;
  const radius = size / 2 - 10;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - value / 100);
  const color = scoreColor(value);
  const isExcelente = score !== null && value >= 90;
  const cx = size / 2;
  const cy = size / 2;
  const circlePath = `M${cx + radius},${cy} A${radius},${radius} 0 1,1 ${cx - radius},${cy} A${radius},${radius} 0 1,1 ${cx + radius},${cy}`;

  return (
    <div className="flex flex-col items-center" style={{ width: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ overflow: "visible" }}>
        <defs>
          <filter id="score-gauge-glow" x="-200%" y="-200%" width="500%" height="500%">
            <feGaussianBlur stdDeviation="3.5" />
          </filter>
        </defs>
        <circle cx={cx} cy={cy} r={radius} fill="none" stroke="rgba(255,255,255,.12)" strokeWidth={10} />
        {score !== null && (
          <circle
            cx={cx}
            cy={cy}
            r={radius}
            fill="none"
            stroke={color}
            strokeWidth={10}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            transform={`rotate(-90 ${cx} ${cy})`}
            style={{ transition: "stroke-dashoffset .6s ease" }}
          />
        )}
        {isExcelente && !reducedMotion && (
          <g color={color}>
            <animateMotion dur="4s" repeatCount="indefinite" rotate="0" path={circlePath} />
            <circle r="9" fill="currentColor" opacity="0.35" filter="url(#score-gauge-glow)" />
            <circle r="3.5" fill="currentColor" />
          </g>
        )}
        <text x="50%" y="46%" textAnchor="middle" fontSize={size * 0.24} fontWeight={700} fill="#fff" fontFamily="var(--font-display)">
          {score !== null ? (value / 10).toFixed(1) : "—"}
        </text>
        {score !== null && (
          <text x="50%" y="60%" textAnchor="middle" fontSize={size * 0.09} fill="rgba(255,255,255,.6)">
            de 10
          </text>
        )}
      </svg>
      {score !== null && (
        <span
          className="mt-1.5 font-mono text-[10px] font-semibold tracking-wider px-2.5 py-0.5 rounded-full"
          style={{ color, border: `1px solid ${color}`, background: `${color}1a` }}
        >
          {scoreLabel(value)}
        </span>
      )}
    </div>
  );
}
