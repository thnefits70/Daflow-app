"use client";

import { useState } from "react";
import { Award } from "lucide-react";
import type { SupplierPriceHistory, SupplierPricePoint } from "@/lib/purchases";

const STATUS_LABEL: Record<string, string> = { APPROVED: "Aprobado", PAID: "Pagado", RECEIVED: "Recibido" };

// Confirmado 2026-09-17, pedido explícito del usuario: paleta para
// distinguir proveedores por color en la gráfica combinada — se repite si
// hay más proveedores que colores (poco probable en la práctica).
const SUPPLIER_COLORS = ["#14C7C7", "#e8a03c", "#a78bfa", "#fb7185", "#38bdf8", "#a3e635"];

// Chart chico para una sola serie proveedor+insumo — a diferencia de
// WeeklyTrendChart (semanas regulares, muchos puntos), aquí las fechas son
// compras reales espaciadas de forma irregular y suele haber pocos puntos.
export function PriceTrendChart({ points }: { points: SupplierPricePoint[] }) {
  const [hover, setHover] = useState<number | null>(null);
  if (points.length === 0) return null;

  // Confirmado 2026-09-17: pedido explícito del usuario — con más de 10
  // compras las fechas fijas debajo de cada punto se amontonan y quedan
  // ilegibles, así que a partir de ahí se ocultan y la fecha pasa a salir
  // solo al pasar el mouse (el tooltip de abajo ya la incluye siempre).
  const showDateLabels = points.length <= 10;

  const width = 560;
  const height = 150;
  const padL = 46;
  const padR = 16;
  const padT = 16;
  const padB = showDateLabels ? 26 : 10;
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

  // Confirmado 2026-09-07, pedido explícito del usuario — cada tramo se
  // colorea según si el precio subió o bajó contra el punto anterior. Corrección
  // del mismo día: igual (sin cambio) NO cuenta como "subida" — solo un
  // aumento real (>, no >=) se pinta de rojo; se mantiene o baja usa el color
  // normal (teal).
  const segments = coords.slice(1).map((c, i) => {
    const rose = points[i + 1].unitCost > points[i].unitCost;
    return { d: `M${coords[i].x.toFixed(1)},${coords[i].y.toFixed(1)} L${c.x.toFixed(1)},${c.y.toFixed(1)}`, color: rose ? "#FF9B90" : "#14C7C7" };
  });
  const fmtDate = (iso: string) => {
    const d = new Date(iso);
    return `${d.getDate()}/${d.getMonth() + 1}/${String(d.getFullYear()).slice(2)}`;
  };
  // Eje y tooltip muestran la fecha de pago cuando ya existe — es lo que le
  // importa a quien aprueba (cuándo se pagó ese precio). Si todavía no se ha
  // pagado (aprobado pero pendiente), cae a la fecha de solicitud y se avisa.
  const effDate = (p: SupplierPricePoint) => p.paidAt ?? p.date;

  return (
    <svg viewBox={`0 0 ${width} ${height}`} width="100%" height={height} preserveAspectRatio="none" className="block" onMouseLeave={() => setHover(null)}>
      {Array.from({ length: 3 }).map((_, i) => {
        const v = yMin + ((yMax - yMin) / 2) * i;
        const y = padT + innerH - ((v - yMin) / (yMax - yMin)) * innerH;
        return (
          <g key={i}>
            <line x1={padL} x2={width - padR} y1={y} y2={y} stroke="var(--color-rule)" strokeWidth="1" />
            <text x={padL - 8} y={y + 3} textAnchor="end" fontSize="10" fill="var(--color-steel)">${v.toFixed(2)}</text>
          </g>
        );
      })}

      {segments.map((s, i) => (
        <path key={i} d={s.d} fill="none" stroke={s.color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      ))}

      {showDateLabels &&
        coords.map((c, i) => (
          <text key={`d-${i}`} x={c.x} y={height - 8} textAnchor="middle" fontSize="9.5" fill="var(--color-steel)">
            {fmtDate(effDate(points[i]))}
          </text>
        ))}

      {coords.map((c, i) => (
        <circle
          key={i}
          cx={c.x}
          cy={c.y}
          r={hover === i ? 6 : 3.5}
          fill={hover === i ? "#14C7C7" : "var(--color-bg)"}
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
          const hasBreakdown = p.shippingPerUnit > 0;
          const boxW = 132;
          const boxH = (hasBreakdown ? 70 : 58) + 13;
          const boxX = Math.max(padL, Math.min(c.x - boxW / 2, width - padR - boxW));
          const boxY = Math.max(2, c.y - boxH - 10);
          return (
            <g pointerEvents="none">
              <rect x={boxX} y={boxY} width={boxW} height={boxH} rx="5" fill="var(--color-surface)" stroke="var(--color-rule)" strokeWidth="1" />
              <text x={boxX + boxW / 2} y={boxY + 16} textAnchor="middle" fontSize="12" fontWeight="700" fill="var(--color-ink)">
                ${p.unitCost.toFixed(2)}
              </text>
              {hasBreakdown && (
                <text x={boxX + boxW / 2} y={boxY + 29} textAnchor="middle" fontSize="8.5" fill="var(--color-steel)">
                  ${p.baseUnitCost.toFixed(2)} + ${p.shippingPerUnit.toFixed(2)} flete
                </text>
              )}
              <text x={boxX + boxW / 2} y={boxY + (hasBreakdown ? 42 : 30)} textAnchor="middle" fontSize="10" fontWeight="600" fill="var(--color-ink)">
                {p.supplierName}
              </text>
              <text x={boxX + boxW / 2} y={boxY + (hasBreakdown ? 55 : 43)} textAnchor="middle" fontSize="9.5" fill="var(--color-steel)">
                {fmtDate(effDate(p))} · {p.quantity} un.
              </text>
              <text x={boxX + boxW / 2} y={boxY + (hasBreakdown ? 67 : 55)} textAnchor="middle" fontSize="9.5" fill="var(--color-steel)">
                {p.paidAt ? "Pagado" : `${STATUS_LABEL[p.status] ?? p.status} · pago pendiente`}
              </text>
              <text x={boxX + boxW / 2} y={boxY + (hasBreakdown ? 80 : 68)} textAnchor="middle" fontSize="9.5" fill="var(--color-steel)">
                Pedido por: {p.requestedByName ?? "?"}
              </text>
            </g>
          );
        })()}
    </svg>
  );
}

// Confirmado 2026-09-17, pedido explícito del usuario: una sola gráfica por
// producto en vez de una por proveedor — todas las compras conectadas por
// UNA línea en orden cronológico real (sin importar a qué proveedor se le
// compró cada vez), y el color de cada punto dice de qué proveedor fue esa
// compra. Así se ve de un vistazo el patrón completo (ej. "casi siempre le
// compro barato a Zheng wu, pero esas veces que le compré a Megaxing fue más
// caro"), en vez de tener que comparar gráficas sueltas una por una.
export function CombinedPriceChart({ suppliers }: { suppliers: SupplierPriceHistory[] }) {
  const [hover, setHover] = useState<number | null>(null);

  const colorBySupplierId = new Map(suppliers.map((s, i) => [s.supplierId, SUPPLIER_COLORS[i % SUPPLIER_COLORS.length]]));
  const effDate = (p: SupplierPricePoint) => p.paidAt ?? p.date;

  const points = suppliers
    .flatMap((s) => s.history.map((p) => ({ ...p, supplierId: s.supplierId })))
    .sort((a, b) => new Date(effDate(a)).getTime() - new Date(effDate(b)).getTime());

  if (points.length === 0) return null;

  const showDateLabels = points.length <= 10;

  const width = 560;
  const height = 150;
  const padL = 46;
  const padR = 16;
  const padT = 16;
  const padB = showDateLabels ? 26 : 10;
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
    <div>
      <svg viewBox={`0 0 ${width} ${height}`} width="100%" height={height} preserveAspectRatio="none" className="block" onMouseLeave={() => setHover(null)}>
        {Array.from({ length: 3 }).map((_, i) => {
          const v = yMin + ((yMax - yMin) / 2) * i;
          const y = padT + innerH - ((v - yMin) / (yMax - yMin)) * innerH;
          return (
            <g key={i}>
              <line x1={padL} x2={width - padR} y1={y} y2={y} stroke="var(--color-rule)" strokeWidth="1" />
              <text x={padL - 8} y={y + 3} textAnchor="end" fontSize="10" fill="var(--color-steel)">${v.toFixed(2)}</text>
            </g>
          );
        })}

        <path d={linePath} fill="none" stroke="#5b6b8c" strokeWidth="1.75" strokeLinejoin="round" strokeLinecap="round" />

        {showDateLabels &&
          coords.map((c, i) => (
            <text key={`d-${i}`} x={c.x} y={height - 8} textAnchor="middle" fontSize="9.5" fill="var(--color-steel)">
              {fmtDate(effDate(points[i]))}
            </text>
          ))}

        {coords.map((c, i) => (
          <circle
            key={i}
            cx={c.x}
            cy={c.y}
            r={hover === i ? 6.5 : 4.5}
            fill={colorBySupplierId.get(points[i].supplierId)}
            stroke="var(--color-bg)"
            strokeWidth={hover === i ? 2 : 1.5}
            onMouseEnter={() => setHover(i)}
            style={{ cursor: "pointer" }}
          />
        ))}

        {hover !== null &&
          (() => {
            const c = coords[hover];
            const p = points[hover];
            const hasBreakdown = p.shippingPerUnit > 0;
            const boxW = 132;
            const boxH = (hasBreakdown ? 70 : 58) + 13;
            const boxX = Math.max(padL, Math.min(c.x - boxW / 2, width - padR - boxW));
            const boxY = Math.max(2, c.y - boxH - 10);
            return (
              <g pointerEvents="none">
                <rect x={boxX} y={boxY} width={boxW} height={boxH} rx="5" fill="var(--color-surface)" stroke="var(--color-rule)" strokeWidth="1" />
                <text x={boxX + boxW / 2} y={boxY + 16} textAnchor="middle" fontSize="12" fontWeight="700" fill="var(--color-ink)">
                  ${p.unitCost.toFixed(2)}
                </text>
                {hasBreakdown && (
                  <text x={boxX + boxW / 2} y={boxY + 29} textAnchor="middle" fontSize="8.5" fill="var(--color-steel)">
                    ${p.baseUnitCost.toFixed(2)} + ${p.shippingPerUnit.toFixed(2)} flete
                  </text>
                )}
                <text x={boxX + boxW / 2} y={boxY + (hasBreakdown ? 42 : 30)} textAnchor="middle" fontSize="10" fontWeight="600" fill="var(--color-ink)">
                  {p.supplierName}
                </text>
                <text x={boxX + boxW / 2} y={boxY + (hasBreakdown ? 55 : 43)} textAnchor="middle" fontSize="9.5" fill="var(--color-steel)">
                  {fmtDate(effDate(p))} · {p.quantity} un.
                </text>
                <text x={boxX + boxW / 2} y={boxY + (hasBreakdown ? 67 : 55)} textAnchor="middle" fontSize="9.5" fill="var(--color-steel)">
                  {p.paidAt ? "Pagado" : `${STATUS_LABEL[p.status] ?? p.status} · pago pendiente`}
                </text>
              </g>
            );
          })()}
      </svg>

      <div className="flex items-center gap-x-4 gap-y-1.5 flex-wrap mt-1.5 pl-1">
        {suppliers.map((s, i) => (
          <div key={s.supplierId} className="flex items-center gap-1.5 text-[11.5px]">
            <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: SUPPLIER_COLORS[i % SUPPLIER_COLORS.length] }} />
            <span className="font-semibold">{s.supplierName}</span>
            {i === 0 && s.recentWithinYear && (
              <span className="flex items-center gap-1 text-[9.5px] font-bold uppercase tracking-wide bg-teal/15 text-teal border border-teal/40 rounded-full px-2 py-0.5">
                <Award size={9} /> Más barato
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// Confirmado 2026-09-07, pedido explícito del usuario — el gráfico solo
// muestra el precio al pasar el mouse; esta lista deja el desglose de cada
// compra siempre visible debajo (fecha, proveedor, cantidad, costo base +
// flete si aplica), para no depender de hacer hover para entender por qué la
// línea se ve como se ve (ej. una línea plana porque las últimas compras
// tuvieron el mismo costo).
export function PriceHistoryBreakdownList({ points }: { points: SupplierPricePoint[] }) {
  if (points.length === 0) return null;
  const fmtDate = (iso: string) => {
    const d = new Date(iso);
    return `${d.getDate()}/${d.getMonth() + 1}/${String(d.getFullYear()).slice(2)}`;
  };
  const effDate = (p: SupplierPricePoint) => p.paidAt ?? p.date;

  return (
    <div className="flex flex-col gap-1.5 mt-2.5">
      {[...points].reverse().map((p, i) => (
        <div key={i} className="flex items-center justify-between gap-3 text-[11px] bg-cloud rounded-md px-2.5 py-1.5">
          <div className="min-w-0">
            <div className="font-semibold truncate">{p.supplierName}</div>
            <div className="text-steel">
              {fmtDate(effDate(p))} · {p.quantity} un. · {p.paidAt ? "pagado" : `${STATUS_LABEL[p.status] ?? p.status} · pago pendiente`}
            </div>
            <div className="text-steel-dim">Pedido por: {p.requestedByName ?? "?"}</div>
          </div>
          <div className="text-right shrink-0">
            <div className="font-bold">${p.unitCost.toFixed(2)}</div>
            {p.shippingPerUnit > 0 && (
              <div className="text-steel-dim text-[9.5px]">
                ${p.baseUnitCost.toFixed(2)} + ${p.shippingPerUnit.toFixed(2)} flete
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
