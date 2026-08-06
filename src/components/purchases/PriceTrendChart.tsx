"use client";

import { useState } from "react";
import type { SupplierPricePoint } from "@/lib/purchases";

const STATUS_LABEL: Record<string, string> = { APPROVED: "Aprobado", PAID: "Pagado", RECEIVED: "Recibido" };

// Chart chico para una sola serie proveedor+insumo — a diferencia de
// WeeklyTrendChart (semanas regulares, muchos puntos), aquí las fechas son
// compras reales espaciadas de forma irregular y suele haber pocos puntos.
export function PriceTrendChart({ points }: { points: SupplierPricePoint[] }) {
  const [hover, setHover] = useState<number | null>(null);
  if (points.length === 0) return null;

  const width = 560;
  const height = 150;
  const padL = 46;
  const padR = 16;
  const padT = 16;
  const padB = 26;
  const innerW = width - padL - padR;
  const innerH = height - padT - padB;

  const costs = points.map((p) => p.unitCost);
  const rawMin = Math.min(...costs);
  const rawMax = Math.max(...costs);
  const span = rawMax - rawMin || rawMax * 0.1 || 1;
  const yMin = Math.max(0, rawMin - span * 0.15);
  const yMax = rawMax + span * 0.15;

  const stepX = points.length > 1 ? innerW / (points.length - 1) : 0;
  const coords = points.map((p, i) => ({
    x: padL + (points.length > 1 ? i * stepX : innerW / 2),
    y: padT + innerH - ((p.unitCost - yMin) / (yMax - yMin)) * innerH,
  }));

  const linePath = coords.map((c, i) => `${i === 0 ? "M" : "L"}${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(" ");
  const fmtDate = (iso: string) => {
    const d = new Date(iso);
    return `${d.getDate()}/${d.getMonth() + 1}/${String(d.getFullYear()).slice(2)}`;
  };

  return (
    <svg viewBox={`0 0 ${width} ${height}`} width="100%" height={height} preserveAspectRatio="none" className="block" onMouseLeave={() => setHover(null)}>
      {Array.from({ length: 3 }).map((_, i) => {
        const v = yMin + ((yMax - yMin) / 2) * i;
        const y = padT + innerH - ((v - yMin) / (yMax - yMin)) * innerH;
        return (
          <g key={i}>
            <line x1={padL} x2={width - padR} y1={y} y2={y} stroke="#24365a" strokeWidth="1" />
            <text x={padL - 8} y={y + 3} textAnchor="end" fontSize="10" fill="#92a3c0">${v.toFixed(2)}</text>
          </g>
        );
      })}

      {coords.length > 1 && <path d={linePath} fill="none" stroke="#14C7C7" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />}

      {coords.map((c, i) => (
        <text key={`d-${i}`} x={c.x} y={height - 8} textAnchor="middle" fontSize="9.5" fill="#92a3c0">
          {fmtDate(points[i].date)}
        </text>
      ))}

      {coords.map((c, i) => (
        <circle
          key={i}
          cx={c.x}
          cy={c.y}
          r={hover === i ? 6 : 3.5}
          fill={hover === i ? "#14C7C7" : "#0a1526"}
          stroke="#14C7C7"
          strokeWidth={hover === i ? 0 : 1.75}
          onMouseEnter={() => setHover(i)}
          style={{ cursor: "pointer" }}
        />
      ))}

      {hover !== null &&
        (() => {
          const c = coords[hover];
          const p = points[hover];
          const boxW = 118;
          const boxH = 46;
          const boxX = Math.max(padL, Math.min(c.x - boxW / 2, width - padR - boxW));
          const boxY = Math.max(2, c.y - boxH - 10);
          return (
            <g pointerEvents="none">
              <rect x={boxX} y={boxY} width={boxW} height={boxH} rx="5" fill="#101f3b" stroke="#24365a" strokeWidth="1" />
              <text x={boxX + boxW / 2} y={boxY + 16} textAnchor="middle" fontSize="12" fontWeight="700" fill="#f1f5fb">
                ${p.unitCost.toFixed(2)}
              </text>
              <text x={boxX + boxW / 2} y={boxY + 30} textAnchor="middle" fontSize="9.5" fill="#92a3c0">
                {fmtDate(p.date)} · {p.quantity} un.
              </text>
              <text x={boxX + boxW / 2} y={boxY + 42} textAnchor="middle" fontSize="9.5" fill="#92a3c0">
                {STATUS_LABEL[p.status] ?? p.status}
              </text>
            </g>
          );
        })()}
    </svg>
  );
}
