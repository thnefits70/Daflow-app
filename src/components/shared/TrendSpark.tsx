"use client";

// Mini-gráfica de tendencia con un punto de luz que viaja de izquierda a
// derecha sobre la línea — rojo si la tendencia es mala, verde si es buena,
// gris si todavía no hay suficiente historial. Compartida entre KPIs
// financieros → Inventario e Inicio (confirmado 2026-08-04).
//
// Modo "detailed" (2026-08-25): agrega puntos visibles en cada mes real +
// etiqueta de mes/valor en el primer y último punto, para que se entienda
// de un vistazo "de cuánto a cuánto" sin tener que leer la tarjeta entera.
// Solo se activa donde hay espacio (panel de Finanzas), no en la tarjeta
// compacta de Inicio.

const MONTH_SHORT = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
function shortMonthLabel(period: string | null | undefined) {
  if (!period) return "";
  const [, m] = period.split("-");
  return MONTH_SHORT[Number(m) - 1] ?? period;
}

function buildSparkPoints(values: (number | null)[], width: number, height: number, padX: number, padY: number) {
  const pts = values.map((v, i) => ({ v, i })).filter((p): p is { v: number; i: number } => p.v !== null);
  if (pts.length < 2) return null;
  const xs = pts.map((p) => p.i);
  const ys = pts.map((p) => p.v);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const spanX = maxX - minX || 1;
  const spanY = maxY - minY || 1;
  return pts.map((p) => ({
    x: padX + ((p.i - minX) / spanX) * (width - padX * 2),
    y: height - padY - ((p.v - minY) / spanY) * (height - padY * 2),
    v: p.v,
    i: p.i,
  }));
}

export function TrendSpark({
  values,
  good,
  height = 54,
  periods,
  valueFormatter,
  detailed = false,
}: {
  values: (number | null)[];
  good: boolean | null;
  height?: number;
  /** periodos "YYYY-MM" alineados 1:1 con `values`, solo se usan en modo detailed */
  periods?: (string | null)[];
  /** cómo mostrar el valor del primer/último punto, ej. (v) => `${v}d` */
  valueFormatter?: (v: number) => string;
  detailed?: boolean;
}) {
  const width = 320;
  const padX = detailed ? 26 : 6;
  const padY = 6;
  const topLabelH = detailed ? 15 : 0;
  const bottomLabelH = detailed ? 13 : 0;
  const totalHeight = height + topLabelH + bottomLabelH;

  const points = buildSparkPoints(values, width, height, padX, padY);
  const color = good === false ? "#e0574a" : good === true ? "#22a67e" : "#92a3c0";

  if (!points) return <div className="text-[11px] text-steel py-2">Aún no hay suficientes meses para ver tendencia.</div>;

  const path = "M" + points.map((p) => `${p.x.toFixed(1)},${(p.y + topLabelH).toFixed(1)}`).join(" L");
  const first = points[0];
  const last = points[points.length - 1];
  const fmt = valueFormatter ?? ((v: number) => v.toFixed(0));
  const glowId = `glow-${Math.random().toString(36).slice(2)}`;

  return (
    <svg width="100%" height={totalHeight} viewBox={`0 0 ${width} ${totalHeight}`} preserveAspectRatio="none">
      <defs>
        <filter id={glowId} x="-100%" y="-100%" width="300%" height="300%">
          <feGaussianBlur stdDeviation="3" result="blur" />
          <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>
      <path d={path} fill="none" stroke={color} strokeWidth="2.5" />
      {detailed && points.map((p) => (
        <circle key={p.i} cx={p.x} cy={p.y + topLabelH} r="2.5" fill={color} opacity={0.5} />
      ))}
      {detailed && (
        <>
          <circle cx={first.x} cy={first.y + topLabelH} r="3.5" fill="#92a3c0" />
          <text x={first.x} y={topLabelH - 4} fontSize="9" fill="#92a3c0" textAnchor="start">{fmt(first.v)}</text>
          <text x={first.x} y={totalHeight - 2} fontSize="9" fill="#92a3c0" textAnchor="start">{shortMonthLabel(periods?.[first.i])}</text>

          <circle cx={last.x} cy={last.y + topLabelH} r="3.5" fill={color} />
          <text x={last.x} y={topLabelH - 4} fontSize="9.5" fontWeight="700" fill={color} textAnchor="end">{fmt(last.v)}</text>
          <text x={last.x} y={totalHeight - 2} fontSize="9" fill={color} textAnchor="end">{shortMonthLabel(periods?.[last.i])}</text>
        </>
      )}
      <circle r="4" fill={color} filter={`url(#${glowId})`}>
        <animateMotion dur="3.2s" repeatCount="indefinite" path={path} />
      </circle>
    </svg>
  );
}
