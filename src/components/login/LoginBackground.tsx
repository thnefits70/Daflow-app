const EDGES: [number, number, number, number, number][] = [
  [120, 620, 340, 420, 0],
  [340, 420, 300, 160, 0.7],
  [340, 420, 620, 480, 1.4],
  [620, 480, 860, 300, 2.1],
  [860, 300, 1120, 420, 2.8],
  [1120, 420, 1380, 220, 3.5],
  [300, 160, 620, 480, 1.9],
  [860, 300, 620, 480, 0.4],
  [1120, 420, 1420, 640, 3.9],
  [120, 620, 300, 160, 2.4],
  [1380, 220, 1120, 420, 1.1],
];

const NODES: [number, number, number, number][] = [
  [120, 620, 0, 3],
  [340, 420, 0.3, 4.5],
  [300, 160, 0.8, 3.5],
  [620, 480, 1.1, 5.5],
  [860, 300, 1.6, 4],
  [1120, 420, 2, 5],
  [1380, 220, 2.5, 3.5],
  [1420, 640, 3, 3],
];

export function LoginBackground() {
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden>
      <div
        className="absolute inset-0 opacity-[0.15]"
        style={{
          backgroundImage: "radial-gradient(rgba(150,180,255,.6) 1px, transparent 1px)",
          backgroundSize: "34px 34px",
        }}
      />

      <div
        className="absolute -top-40 -left-32 w-[560px] h-[560px] rounded-full opacity-25 blur-[110px]"
        style={{ background: "radial-gradient(circle, #1E5EFF, transparent 70%)", animation: "daflow-drift 22s ease-in-out infinite" }}
      />
      <div
        className="absolute -bottom-48 -right-24 w-[620px] h-[620px] rounded-full opacity-20 blur-[120px]"
        style={{ background: "radial-gradient(circle, #14C7C7, transparent 70%)", animation: "daflow-drift-slow 26s ease-in-out infinite" }}
      />
      <div
        className="absolute top-1/3 right-1/4 w-[340px] h-[340px] rounded-full opacity-[0.14] blur-[100px]"
        style={{ background: "radial-gradient(circle, #7C5CFF, transparent 70%)", animation: "daflow-drift 30s ease-in-out infinite" }}
      />

      <svg
        className="absolute inset-0 w-full h-full opacity-[0.55]"
        viewBox="0 0 1536 782"
        preserveAspectRatio="xMidYMid slice"
        fill="none"
      >
        <defs>
          <filter id="daflow-node-glow" x="-200%" y="-200%" width="500%" height="500%">
            <feGaussianBlur stdDeviation="3.2" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {EDGES.map(([x1, y1, x2, y2], i) => (
          <line key={`e${i}`} x1={x1} y1={y1} x2={x2} y2={y2} stroke="#2C4A82" strokeWidth="1" />
        ))}

        {EDGES.map(([x1, y1, x2, y2, delay], i) => (
          <circle key={`p${i}`} r="3" fill={i % 2 === 0 ? "#8FD8FF" : "#7CF3E0"}>
            <animateMotion
              dur={`${4 + (i % 3)}s`}
              begin={`${delay}s`}
              repeatCount="indefinite"
              path={`M${x1},${y1} L${x2},${y2}`}
            />
            <animate
              attributeName="opacity"
              values="0;.9;.9;0"
              dur={`${4 + (i % 3)}s`}
              begin={`${delay}s`}
              repeatCount="indefinite"
            />
          </circle>
        ))}

        {NODES.map(([cx, cy, delay, r], i) => (
          <circle
            key={i}
            cx={cx}
            cy={cy}
            r={r}
            fill={i % 3 === 0 ? "#14C7C7" : "#4C86FF"}
            filter="url(#daflow-node-glow)"
            style={{ animation: `daflow-node-pulse 3.6s ease-in-out infinite`, animationDelay: `${delay}s` }}
          />
        ))}
      </svg>
    </div>
  );
}
