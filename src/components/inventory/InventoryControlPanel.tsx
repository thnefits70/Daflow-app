"use client";

import { useState } from "react";
import { AlertTriangle } from "lucide-react";
import type { InventoryControlPeriodDTO } from "@/lib/inventoryKpis";
import { TabGuide } from "@/components/shared/TabGuide";

const MONTH_NAMES = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
function monthLabel(period: string) {
  const [y, m] = period.split("-");
  return `${MONTH_NAMES[Number(m) - 1] ?? m} ${y}`;
}
function money(v: number) {
  return "$" + v.toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function InventoryControlPanel({
  currentPeriodDefault,
  periods,
}: {
  currentPeriodDefault: string;
  periods: InventoryControlPeriodDTO[];
}) {
  const [period, setPeriod] = useState(currentPeriodDefault);
  const selectedData = periods.find((p) => p.period === period) ?? null;

  return (
    <div className="flex flex-col gap-4.5">
      <TabGuide storageKey="control-inventario">
        Todo se calcula solo desde INVESTOCK — el valor de inventario de cada mes y el ranking semanal de productos sin movimiento. No tienes que subir nada.
      </TabGuide>
      <div className="bg-surface border border-rule rounded-md p-4.5">
        <div className="flex items-center justify-between mb-1">
          <div className="font-semibold text-[13.5px]">Valor de inventario del mes</div>
          <span className="font-mono text-[10px] uppercase text-steel bg-cloud rounded-full px-2 py-0.5">Automático</span>
        </div>
        <div className="text-[11.5px] text-steel mb-3">
          Ya no hace falta escribirlo ni adjuntar captura — se calcula solo desde INVESTOCK (stock real × costo promedio real de cada producto, al cierre de ese mes).
        </div>

        <div className="mb-3">
          <label className="block mb-1 text-[10px] uppercase tracking-wide text-steel">Mes</label>
          <select
            className="rounded border border-rule bg-cloud px-2.5 py-2 text-[13px] font-mono"
            value={period}
            onChange={(e) => setPeriod(e.target.value)}
          >
            {periods.map((p) => (
              <option key={p.period} value={p.period}>
                {monthLabel(p.period)}{p.value !== null ? " · calculado" : ""}{p.period === currentPeriodDefault ? " (actual)" : ""}
              </option>
            ))}
          </select>
        </div>

        {selectedData?.value !== null && selectedData?.value !== undefined ? (
          <div>
            <div className="font-display text-[22px] font-bold mb-1.5">{money(selectedData.value)}</div>
            {selectedData.source === "auto" ? (
              <div className="text-[11.5px] text-steel">Calculado en tiempo real desde INVESTOCK.</div>
            ) : (
              <div className="text-[11.5px] text-steel">Valor histórico cargado a mano antes de automatizar este cálculo.</div>
            )}
          </div>
        ) : (
          <div className="flex items-center gap-2 text-[11.5px] text-steel">
            <AlertTriangle size={13} /> Sin movimientos en INVESTOCK para {monthLabel(period)} todavía.
          </div>
        )}
      </div>
      <div className="bg-surface border border-rule rounded-md p-4.5">
        <div className="flex items-center justify-between mb-1">
          <div className="font-semibold text-[13.5px]">Productos sin movimiento — stock por SKU</div>
          <span className="font-mono text-[10px] uppercase text-steel bg-cloud rounded-full px-2 py-0.5">Automático</span>
        </div>
        <div className="text-[11.5px] text-steel">
          Ya no hace falta subir ningún Excel — cada semana DAFLOW toma el stock real de cada producto desde INVESTOCK y arma solo el ranking de productos sin movimiento (se ve en KPIs financieros → Inventario).
        </div>
      </div>
    </div>
  );
}
