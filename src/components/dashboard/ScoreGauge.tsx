function scoreColor(score: number) {
  if (score >= 75) return "#14C7C7"; // teal — bueno
  if (score >= 50) return "#1E5EFF"; // blue — regular
  return "#C4453A"; // red — riesgo
}

function scoreLabel(score: number) {
  if (score >= 75) return "BUENO";
  if (score >= 50) return "REGULAR";
  return "RIESGO";
}

export function ScoreGauge({ score, size = 150 }: { score: number | null; size?: number }) {
  const value = score ?? 0;
  const radius = size / 2 - 10;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - value / 100);
  const color = scoreColor(value);

  return (
    <div className="flex flex-col items-center" style={{ width: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="rgba(255,255,255,.12)" strokeWidth={10} />
        {score !== null && (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={color}
            strokeWidth={10}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
            style={{ transition: "stroke-dashoffset .6s ease" }}
          />
        )}
        <text x="50%" y="46%" textAnchor="middle" fontSize={size * 0.24} fontWeight={700} fill="#fff" fontFamily="var(--font-display)">
          {score !== null ? value : "—"}
        </text>
        {score !== null && (
          <text x="50%" y="60%" textAnchor="middle" fontSize={size * 0.09} fill="rgba(255,255,255,.6)">
            de 100
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
