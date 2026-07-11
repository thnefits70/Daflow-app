const EDGES: [number, number, number, number, number][] = [
  [120, 620, 340, 420, 0],
  [340, 420, 300, 160, 0.6],
  [340, 420, 620, 480, 1.1],
  [620, 480, 860, 300, 1.7],
  [860, 300, 1120, 420, 2.2],
  [1120, 420, 1380, 220, 2.8],
  [300, 160, 620, 480, 1.4],
  [860, 300, 620, 480, 2],
  [1120, 420, 1420, 640, 3.1],
];

const NODES: [number, number, number][] = [
  [120, 620, 0],
  [340, 420, 0.3],
  [300, 160, 0.8],
  [620, 480, 1.1],
  [860, 300, 1.6],
  [1120, 420, 2],
  [1380, 220, 2.5],
  [1420, 640, 3],
];

export function LoginBackground() {
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden>
      <div
        className="absolute -top-40 -left-32 w-[560px] h-[560px] rounded-full opacity-25 blur-[110px]"
        style={{ background: "radial-gradient(circle, #1E5EFF, transparent 70%)", animation: "daflow-drift 22s ease-in-out infinite" }}
      />
      <div
        className="absolute -bottom-48 -right-24 w-[620px] h-[620px] rounded-full opacity-20 blur-[120px]"
        style={{ background: "radial-gradient(circle, #14C7C7, transparent 70%)", animation: "daflow-drift-slow 26s ease-in-out infinite" }}
      />

      <svg
        className="absolute inset-0 w-full h-full opacity-[0.35]"
        viewBox="0 0 1536 782"
        preserveAspectRatio="xMidYMid slice"
        fill="none"
      >
        {EDGES.map(([x1, y1, x2, y2, delay], i) => (
          <line
            key={i}
            x1={x1}
            y1={y1}
            x2={x2}
            y2={y2}
            stroke="#3E7BFF"
            strokeWidth="1.25"
            strokeDasharray="6 10"
            style={{ animation: `daflow-flow 6s linear infinite`, animationDelay: `${delay}s` }}
          />
        ))}
        {NODES.map(([cx, cy, delay], i) => (
          <circle
            key={i}
            cx={cx}
            cy={cy}
            r="3"
            fill={i % 3 === 0 ? "#14C7C7" : "#3E7BFF"}
            style={{ animation: `daflow-node-pulse 3.6s ease-in-out infinite`, animationDelay: `${delay}s` }}
          />
        ))}
      </svg>
    </div>
  );
}
