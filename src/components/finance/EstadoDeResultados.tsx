"use client";

import { Fragment, useRef } from "react";
import type { FinanceMonthDerived } from "@/lib/financeKpisCalc";

const MONTH_NAMES = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
function monthLabel(period: string) {
  const [y, m] = period.split("-");
  return `${MONTH_NAMES[Number(m) - 1] ?? m} ${y}`;
}
function money(v: number) {
  return "$" + Math.round(v).toLocaleString("es-MX");
}
function pct(v: number) {
  return v.toFixed(1) + "%";
}

type Row = {
  label: string;
  key: keyof FinanceMonthDerived;
  sign?: "+" | "−";
  subtotal?: boolean;
  hero?: boolean;
  marginKey?: keyof FinanceMonthDerived;
};

const ROWS: Row[] = [
  { label: "Ventas", key: "ventas" },
  { label: "Costo de ventas", key: "costoVentas", sign: "−" },
  { label: "Utilidad bruta", key: "utilidadBruta", subtotal: true, marginKey: "margenBruto" },
  { label: "Gastos de venta", key: "gastosVenta", sign: "−" },
  { label: "Gastos administrativos", key: "gastosAdmin", sign: "−" },
  { label: "Utilidad operativa", key: "utilidadOperativa", subtotal: true, marginKey: "margenOperativo" },
  { label: "Otros ingresos", key: "otrosIngresos", sign: "+" },
  { label: "Gastos financieros", key: "gastosFinancieros", sign: "−" },
  { label: "Otros gastos", key: "otrosGastos", sign: "−" },
  { label: "Utilidad neta", key: "utilidadReportada", subtotal: true, hero: true, marginKey: "margenNeto" },
];

export function EstadoDeResultados({ series }: { series: FinanceMonthDerived[] }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const dragState = useRef<{ down: boolean; startX: number; startScroll: number }>({ down: false, startX: 0, startScroll: 0 });

  if (series.length === 0) {
    return <div className="text-steel text-[12.5px] py-4 text-center">Aún no hay meses cargados.</div>;
  }

  return (
    <div
      ref={scrollRef}
      className="overflow-x-auto cursor-grab active:cursor-grabbing"
      onMouseDown={(e) => { dragState.current = { down: true, startX: e.pageX, startScroll: scrollRef.current?.scrollLeft ?? 0 }; }}
      onMouseUp={() => { dragState.current.down = false; }}
      onMouseLeave={() => { dragState.current.down = false; }}
      onMouseMove={(e) => {
        if (!dragState.current.down || !scrollRef.current) return;
        e.preventDefault();
        scrollRef.current.scrollLeft = dragState.current.startScroll - (e.pageX - dragState.current.startX);
      }}
    >
      <table className="border-collapse text-[12.5px] min-w-full">
        <thead>
          <tr>
            <th className="text-left font-mono text-[10px] uppercase text-steel font-semibold pb-2 pr-4 sticky left-0 bg-surface min-w-[190px]">Partida</th>
            {series.map((r) => (
              <th key={r.period} className="text-right font-mono text-[10px] uppercase text-steel font-semibold pb-2 px-3 whitespace-nowrap">{monthLabel(r.period)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {ROWS.map((row) => (
            <Fragment key={row.key}>
              <tr className={row.subtotal ? "border-t border-b border-rule" : ""}>
                <td className={`py-1.5 pr-4 sticky left-0 bg-surface ${row.subtotal ? "font-bold" : ""} ${row.hero ? "text-teal" : ""}`}>
                  {row.label}
                </td>
                {series.map((r) => {
                  const v = r[row.key] as number;
                  const text = row.sign ? `${row.sign}${money(Math.abs(v))}` : money(v);
                  return (
                    <td key={r.period} className={`py-1.5 px-3 text-right font-mono whitespace-nowrap ${row.subtotal ? "font-bold" : ""} ${!row.subtotal && v < 0 ? "text-red" : ""}`}>
                      {text}
                    </td>
                  );
                })}
              </tr>
              {row.marginKey && (
                <tr>
                  <td className="text-steel text-[10.5px] pb-2 pr-4 sticky left-0 bg-surface">Margen</td>
                  {series.map((r) => (
                    <td key={r.period} className="text-steel text-[10.5px] pb-2 px-3 text-right font-mono whitespace-nowrap">
                      {pct(r[row.marginKey!] as number)}
                    </td>
                  ))}
                </tr>
              )}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}
