"use client";

import { roiStatus } from "@/lib/financeKpisCalc";

function polarToCartesian(cx: number, cy: number, r: number, angleDeg: number) {
  const rad = (angleDeg * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy - r * Math.sin(rad) };
}
function describeArc(cx: number, cy: number, r: number, startAngle: number, endAngle: number) {
  const start = polarToCartesian(cx, cy, r, startAngle);
  const end = polarToCartesian(cx, cy, r, endAngle);
  const largeArcFlag = Math.abs(startAngle - endAngle) > 180 ? 1 : 0;
  return `M ${start.x.toFixed(1)} ${start.y.toFixed(1)} A ${r} ${r} 0 ${largeArcFlag} 1 ${end.x.toFixed(1)} ${end.y.toFixed(1)}`;
}

const STATUS_COLOR = { good: "#22a67e", warn: "#d9a441", crit: "#e0574a" } as const;

export function RoiGauge({
  value,
  compareValue,
  compareLabel,
  bands,
  max = 30,
}: {
  value: number | null;
  compareValue?: number | null;
  compareLabel?: string;
  bands: { red: number; yellow: number; target: number };
  max?: number;
}) {
  if (value === null) {
    return <div className="text-center text-steel text-[12.5px] py-5">Aún no hay ROI cargado para este mes.</div>;
  }

  const w = 320, h = 195, cx = w / 2, cy = 165, r = 120, thickness = 26;
  const toAngle = (v: number) => 180 - (Math.min(Math.max(v, 0), max) / max) * 180;
  const bandDefs = [
    { from: 0, to: bands.red, color: STATUS_COLOR.crit },
    { from: bands.red, to: bands.yellow, color: STATUS_COLOR.warn },
    { from: bands.yellow, to: max, color: STATUS_COLOR.good },
  ];
  const arcs = bandDefs.map((b, i) => (
    <path key={i} d={describeArc(cx, cy, r, toAngle(b.from), toAngle(b.to))} fill="none" stroke={b.color} strokeWidth={thickness} />
  ));

  const needleAngle = toAngle(value);
  const needleTip = polarToCartesian(cx, cy, r - thickness / 2 - 4, needleAngle);
  const needleBaseL = polarToCartesian(cx, cy, 9, needleAngle + 90);
  const needleBaseR = polarToCartesian(cx, cy, 9, needleAngle - 90);

  const targetAngle = toAngle(bands.target);
  const tOuter = polarToCartesian(cx, cy, r + thickness / 2 + 4, targetAngle);
  const tInner = polarToCartesian(cx, cy, r - thickness / 2 - 4, targetAngle);

  let compareTick: React.ReactNode = null;
  if (compareValue !== null && compareValue !== undefined) {
    const bAngle = toAngle(compareValue);
    const p1 = polarToCartesian(cx, cy, r - thickness - 2, bAngle);
    const p2 = polarToCartesian(cx, cy, r + 2, bAngle);
    compareTick = (
      <>
        <line x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y} stroke="#d9a441" strokeWidth={2.5} strokeDasharray="1,3" />
        <circle cx={p2.x} cy={p2.y} r={5} fill="none" stroke="#d9a441" strokeWidth={2} />
      </>
    );
  }

  const status = roiStatus(value, bands);
  const statusColor = STATUS_COLOR[status.cls];
  const minPt = polarToCartesian(cx, cy, r + thickness / 2 + 12, 180);
  const maxPt = polarToCartesian(cx, cy, r + thickness / 2 + 12, 0);

  return (
    <div className="max-w-[360px] mx-auto">
      <svg viewBox={`0 0 ${w} ${h}`} width="100%" height={h} style={{ overflow: "visible" }}>
        {arcs}
        <line x1={tInner.x} y1={tInner.y} x2={tOuter.x} y2={tOuter.y} stroke="#f1f5fb" strokeWidth={2} />
        <text x={tOuter.x} y={tOuter.y - 4} textAnchor="middle" fontSize="9.5" fill="#f1f5fb">Objetivo {bands.target}%</text>
        {compareTick}
        <polygon
          points={`${needleTip.x.toFixed(1)},${needleTip.y.toFixed(1)} ${needleBaseL.x.toFixed(1)},${needleBaseL.y.toFixed(1)} ${needleBaseR.x.toFixed(1)},${needleBaseR.y.toFixed(1)}`}
          fill="#92a3c0"
        />
        <circle cx={cx} cy={cy} r={10} fill="#101f3b" stroke="#92a3c0" strokeWidth={2} />
        <text x={minPt.x} y={minPt.y} textAnchor="middle" fontSize="10.5" fill="#92a3c0">0%</text>
        <text x={maxPt.x} y={maxPt.y} textAnchor="middle" fontSize="10.5" fill="#92a3c0">{max}%</text>
      </svg>
      <div className="text-center -mt-3.5">
        <div className="font-display text-[32px] font-bold" style={{ color: statusColor }}>{value.toFixed(1)}%</div>
        <div className="text-[11.5px] font-bold mt-0.5" style={{ color: statusColor }}>{status.label}</div>
        {compareValue !== null && compareValue !== undefined && compareLabel && (
          <div className="text-[11px] text-steel mt-1">Línea dorada punteada = {compareLabel} ({compareValue.toFixed(1)}%)</div>
        )}
      </div>
      <div className="text-[11px] text-steel mt-2.5 text-center">
        🔴 &lt;{bands.red}% bajo/alerta · 🟡 {bands.red}–{bands.yellow}% regular · 🟢 &gt;{bands.yellow}% saludable
      </div>
    </div>
  );
}
