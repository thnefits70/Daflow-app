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
  const width = 220;
  const height = 56;
  const max = Math.max(...points.map((p) => p.value), 1);
  const min = Math.min(...points.map((p) => p.value), 0);
  const range = Math.max(max - min, 1);

  const stepX = points.length > 1 ? width / (points.length - 1) : 0;
  const coords = points.map((p, i) => {
    const x = points.length > 1 ? i * stepX : width / 2;
    const y = height - ((p.value - min) / range) * (height - 6) - 3;
    return { x, y };
  });

  const linePath = coords.map((c, i) => `${i === 0 ? "M" : "L"}${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(" ");
  const areaPath = `${linePath} L${width},${height} L0,${height} Z`;

  const goalPct = weeklyGoal ? Math.round((latest.value / weeklyGoal) * 100) : null;
  const status = goalPct !== null ? goalStatus(goalPct) : null;

  return (
    <div>
      <div className="text-[11px] font-semibold tracking-wide uppercase text-[#B9C2CC] mb-2">
        {label} · {deptName}
      </div>
      <div className="flex items-end gap-3">
        <div>
          <div className="font-display text-[30px] font-bold text-white leading-none">
            {latest.value.toLocaleString("es-MX")}
          </div>
          <div className="text-[11px] text-[#B9C2CC] mt-1">{formatWeekShort(latest.week)} (última semana)</div>
        </div>
        <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="shrink-0">
          <defs>
            <linearGradient id="weekly-trend-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#14C7C7" stopOpacity="0.35" />
              <stop offset="100%" stopColor="#14C7C7" stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={areaPath} fill="url(#weekly-trend-fill)" />
          <path d={linePath} fill="none" stroke="#14C7C7" strokeWidth="1.75" strokeLinejoin="round" strokeLinecap="round" />
          {coords.length > 0 && (
            <circle cx={coords[coords.length - 1].x} cy={coords[coords.length - 1].y} r="2.5" fill="#14C7C7" />
          )}
        </svg>
      </div>
      {status && goalPct !== null && (
        <div className="mt-2.5 flex items-center gap-2">
          <span
            className="font-mono text-[10px] font-semibold tracking-wider px-2.5 py-0.5 rounded-full"
            style={{ color: status.color, border: `1px solid ${status.color}`, background: `${status.color}1a` }}
          >
            {status.label}
          </span>
          <span className="text-[11px] text-[#B9C2CC]">
            {goalPct}% de la meta semanal ({weeklyGoal!.toLocaleString("es-MX")})
          </span>
        </div>
      )}
    </div>
  );
}
