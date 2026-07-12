export type WeeklyPoint = { week: string; value: number };

function formatWeekShort(week: string) {
  const [, w] = week.split("-W");
  return `S${Number(w)}`;
}

function goalStatus(pct: number) {
  if (pct >= 100) return { label: "Excelente", color: "#14C7C7" };
  if (pct >= 80) return { label: "Eficiente", color: "#1E5EFF" };
  return { label: "No eficiente", color: "#C4453A" };
}

function niceMax(value: number) {
  if (value <= 0) return 10;
  const magnitude = Math.pow(10, Math.floor(Math.log10(value)));
  const normalized = value / magnitude;
  const niceNormalized = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return niceNormalized * magnitude;
}

function smoothPath(coords: { x: number; y: number }[]) {
  if (coords.length === 0) return "";
  if (coords.length === 1) return `M${coords[0].x},${coords[0].y}`;
  let d = `M${coords[0].x.toFixed(1)},${coords[0].y.toFixed(1)}`;
  for (let i = 0; i < coords.length - 1; i++) {
    const p0 = coords[i - 1] ?? coords[i];
    const p1 = coords[i];
    const p2 = coords[i + 1];
    const p3 = coords[i + 2] ?? p2;
    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C${cp1x.toFixed(1)},${cp1y.toFixed(1)} ${cp2x.toFixed(1)},${cp2y.toFixed(1)} ${p2.x.toFixed(1)},${p2.y.toFixed(1)}`;
  }
  return d;
}

export function WeeklyTrendChart({
  label,
  deptName,
  points,
  weeklyGoal,
}: {
  label: string;
  deptName: string;
  points: WeeklyPoint[];
  weeklyGoal?: number;
}) {
  if (points.length === 0) return null;

  const latest = points[points.length - 1];
  const width = 1000;
  const height = 300;
  const padL = 52;
  const padR = 20;
  const padT = 16;
  const padB = 30;
  const innerW = width - padL - padR;
  const innerH = height - padT - padB;

  const rawMax = Math.max(...points.map((p) => p.value), 0);
  const yMax =
    weeklyGoal && rawMax <= weeklyGoal ? weeklyGoal : niceMax(Math.max(rawMax, weeklyGoal ?? 0) * 1.08);
  const yTicks = 4;

  const stepX = points.length > 1 ? innerW / (points.length - 1) : 0;
  const coords = points.map((p, i) => ({
    x: padL + (points.length > 1 ? i * stepX : innerW / 2),
    y: padT + innerH - (p.value / yMax) * innerH,
  }));

  const linePath = smoothPath(coords);
  const last = coords[coords.length - 1];
  const areaPath = `${linePath} L${last.x.toFixed(1)},${(padT + innerH).toFixed(1)} L${coords[0].x.toFixed(1)},${(padT + innerH).toFixed(1)} Z`;

  const goalPct = weeklyGoal ? Math.round((latest.value / weeklyGoal) * 100) : null;
  const status = goalPct !== null ? goalStatus(goalPct) : null;
  const goalYRaw = weeklyGoal ? padT + innerH - (weeklyGoal / yMax) * innerH : null;
  const goalY = goalYRaw !== null && goalYRaw > padT + 4 ? goalYRaw : null;

  const tickEvery = Math.max(1, Math.ceil(points.length / 12));

  return (
    <div>
      <div className="flex items-start justify-between flex-wrap gap-4 mb-5">
        <div>
          <div className="text-[11px] font-semibold tracking-wide uppercase text-steel mb-1.5">
            {label} · {deptName}
          </div>
          <div className="flex items-baseline gap-2.5">
            <span className="font-display text-[32px] font-bold text-ink leading-none">
              {latest.value.toLocaleString("es-MX")}
            </span>
            <span className="text-[12px] text-steel">{formatWeekShort(latest.week)} (última semana)</span>
          </div>
        </div>
        {status && goalPct !== null && (
          <div className="flex items-center gap-2.5">
            <span
              className="font-mono text-[10.5px] font-semibold tracking-wider px-2.5 py-1 rounded-full"
              style={{ color: status.color, border: `1px solid ${status.color}`, background: `${status.color}1a` }}
            >
              {status.label}
            </span>
            <span className="text-[12px] text-steel">
              {goalPct}% de la meta semanal ({weeklyGoal!.toLocaleString("es-MX")})
            </span>
          </div>
        )}
      </div>

      <svg viewBox={`0 0 ${width} ${height}`} width="100%" height={height} preserveAspectRatio="none" className="block">
        <defs>
          <linearGradient id="weekly-trend-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#14C7C7" stopOpacity="0.32" />
            <stop offset="100%" stopColor="#14C7C7" stopOpacity="0" />
          </linearGradient>
        </defs>

        {Array.from({ length: yTicks + 1 }).map((_, i) => {
          const v = (yMax / yTicks) * i;
          const y = padT + innerH - (v / yMax) * innerH;
          return (
            <g key={i}>
              <line x1={padL} x2={width - padR} y1={y} y2={y} stroke="#24365a" strokeWidth="1" />
              <text x={padL - 10} y={y + 3} textAnchor="end" fontSize="11" fill="#92a3c0">
                {Math.round(v).toLocaleString("es-MX")}
              </text>
            </g>
          );
        })}

        {goalY !== null && (
          <>
            <line x1={padL} x2={width - padR} y1={goalY} y2={goalY} stroke="#C4453A" strokeWidth="1.25" strokeDasharray="5 4" opacity="0.75" />
            <text x={width - padR} y={goalY - 6} textAnchor="end" fontSize="10.5" fill="#C4453A">
              Meta {weeklyGoal!.toLocaleString("es-MX")}
            </text>
          </>
        )}

        {coords.map((c, i) =>
          i % tickEvery === 0 || i === coords.length - 1 ? (
            <text key={i} x={c.x} y={height - 8} textAnchor="middle" fontSize="10.5" fill="#92a3c0">
              {formatWeekShort(points[i].week)}
            </text>
          ) : null
        )}

        <path d={areaPath} fill="url(#weekly-trend-fill)" />
        <path d={linePath} fill="none" stroke="#14C7C7" strokeWidth="2.25" strokeLinejoin="round" strokeLinecap="round" />
        {coords.map((c, i) =>
          i === coords.length - 1 ? (
            <circle key={i} cx={c.x} cy={c.y} r="4" fill="#14C7C7" />
          ) : (
            <circle key={i} cx={c.x} cy={c.y} r="2" fill="#0a1526" stroke="#14C7C7" strokeWidth="1.5" />
          )
        )}
      </svg>
    </div>
  );
}
