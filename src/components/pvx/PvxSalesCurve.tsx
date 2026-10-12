// Curva de ventas del producto en provedix.com (pedido del usuario
// 2026-10-12): solo la forma — cómo se movió el volumen día a día en los
// últimos 30 días —, sin fechas ni cifras. Los valores ya vienen 0–100 y
// suavizados desde el resumen (salesCurve en provedixSnapshot.ts).
// También va chica en cada tarjeta del catálogo (height + 7/30 días).

import { useId } from "react";

const W = 300;
const PAD = 4;

// Curva suave que pasa por cada punto (Catmull-Rom → Bézier), sin pasarse
// de los bordes.
function smoothPath(pts: [number, number][], H: number): string {
  if (pts.length < 2) return "";
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, y0] = pts[Math.max(0, i - 1)];
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[i + 1];
    const [x3, y3] = pts[Math.min(pts.length - 1, i + 2)];
    const clamp = (y: number) => Math.min(H - PAD, Math.max(PAD, y));
    const c1x = x1 + (x2 - x0) / 6;
    const c1y = clamp(y1 + (y2 - y0) / 6);
    const c2x = x2 - (x3 - x1) / 6;
    const c2y = clamp(y2 - (y3 - y1) / 6);
    d += ` C${c1x.toFixed(1)},${c1y.toFixed(1)} ${c2x.toFixed(1)},${c2y.toFixed(1)} ${x2.toFixed(1)},${y2.toFixed(1)}`;
  }
  return d;
}

export function PvxSalesCurve({ values, height = 70, labels = true }: { values: number[]; height?: number; labels?: boolean }) {
  const H = height;
  const gradientId = `pvx-curve-${useId().replace(/:/g, "")}`;
  const step = (W - PAD * 2) / Math.max(1, values.length - 1);
  const pts = values.map((v, i): [number, number] => [PAD + i * step, H - PAD - (v / 100) * (H - PAD * 2)]);
  const line = smoothPath(pts, H);
  const area = `${line} L${pts[pts.length - 1][0]},${H} L${pts[0][0]},${H} Z`;
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="w-full block" style={{ height: H }} aria-label="Curva de ventas" role="img">
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#ff5a1f" stopOpacity="0.28" />
            <stop offset="100%" stopColor="#ff5a1f" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={area} fill={`url(#${gradientId})`} />
        <path d={line} fill="none" stroke="#ff5a1f" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      </svg>
      {labels && (
        <div className="flex justify-between text-[10px] text-[#8a8f98] mt-0.5">
          <span>Antes</span>
          <span>Reciente</span>
        </div>
      )}
    </div>
  );
}
