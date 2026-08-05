"use client";

// Mini-gráfica de tendencia con un punto de luz que viaja de izquierda a
// derecha sobre la línea — rojo si la tendencia es mala, verde si es buena,
// gris si todavía no hay suficiente historial. Compartida entre KPIs
// financieros → Inventario e Inicio (confirmado 2026-08-04).
function buildSparkPath(values: (number | null)[], width = 320, height = 54, pad = 6) {
  const pts = values.map((v, i) => ({ v, i })).filter((p): p is { v: number; i: number } => p.v !== null);
  if (pts.length < 2) return null;
  const xs = pts.map((p) => p.i);
  const ys = pts.map((p) => p.v);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const spanX = maxX - minX || 1;
  const spanY = maxY - minY || 1;
  const coords = pts.map((p) => {
    const x = pad + ((p.i - minX) / spanX) * (width - pad * 2);
    const y = height - pad - ((p.v - minY) / spanY) * (height - pad * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  return coords.join(" L").replace(/^/, "M");
}

export function TrendSpark({ values, good, height = 54 }: { values: (number | null)[]; good: boolean | null; height?: number }) {
  const path = buildSparkPath(values, 320, height);
  const color = good === false ? "#e0574a" : good === true ? "#22a67e" : "#92a3c0";
  if (!path) return <div className="text-[11px] text-steel py-2">Aún no hay suficientes meses para ver tendencia.</div>;
  const glowId = `glow-${Math.random().toString(36).slice(2)}`;
  return (
    <svg width="100%" height={height} viewBox={`0 0 320 ${height}`} preserveAspectRatio="none">
      <defs>
        <filter id={glowId} x="-100%" y="-100%" width="300%" height="300%">
          <feGaussianBlur stdDeviation="3" result="blur" />
          <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>
      <path d={path} fill="none" stroke={color} strokeWidth="2.5" />
      <circle r="4" fill={color} filter={`url(#${glowId})`}>
        <animateMotion dur="3.2s" repeatCount="indefinite" path={path} />
      </circle>
    </svg>
  );
}
