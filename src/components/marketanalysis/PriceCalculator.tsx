"use client";

import { useState } from "react";

function money(n: number) {
  return `$${n.toFixed(2)}`;
}

// Corregido 2026-09-17, pedido explícito del usuario: esta previsualización
// dividía el costo unitario entre las unidades del lote, como si el costo
// fuera del lote completo — desde 2026-09-10 batchCost ya es el costo POR
// UNIDAD (ver bodegaUnitCost en lib/marketProduct.ts), solo el flete se
// reparte entre unidades. El número que veía Jariel acá no coincidía con el
// que realmente se guardaba y calculaba server-side.
export function computePreviewPrice(batchCost: number, batchUnits: number, freightCost: number, insurance: number, fulfillment: number, margin: number) {
  if (!batchCost || !batchUnits || margin >= 100) return null;
  const bodegaUnitCost = batchCost + (freightCost || 0) / batchUnits;
  const unitCost = bodegaUnitCost * (1 + insurance / 100);
  return (unitCost + fulfillment) / (1 - margin / 100);
}

// Confirmado 2026-09-17, pedido explícito del usuario: comparación contra el
// precio de la competencia. El margen resultante de vender a ese precio
// varía según el fulfillment ($0.75 default vs $0.50 chico, únicas dos
// opciones de la calculadora) — de ahí sale el rango mínimo/máximo, no de
// negociar el costo con el proveedor.
export function computeCompetitorComparison(batchCost: number, batchUnits: number, freightCost: number, insurance: number, competitorPrice: number) {
  if (!batchCost || !batchUnits || !competitorPrice) return null;
  const bodegaUnitCost = batchCost + (freightCost || 0) / batchUnits;
  const unitCostWithInsurance = bodegaUnitCost * (1 + insurance / 100);
  const marginAt = (fulfillment: number) => (1 - (unitCostWithInsurance + fulfillment) / competitorPrice) * 100;
  return {
    // Fulfillment $0.75 (más caro) deja el margen más bajo; $0.50 deja el más alto.
    marginMin: marginAt(0.75),
    marginMax: marginAt(0.50),
  };
}

// Confirmado 2026-10-05, pedido del usuario: Nairoby hace las compras frías y
// necesita la misma calculadora de Proponer (Análisis de Mercado) para sus
// análisis. Es solo para sacar cuentas — no guarda nada ni envía nada.
export function PriceCalculator() {
  const [cost, setCost] = useState("");
  const [units, setUnits] = useState("");
  const [freight, setFreight] = useState("");
  const [noFreight, setNoFreight] = useState(false);
  const [competitorPrice, setCompetitorPrice] = useState("");
  const [insurance, setInsurance] = useState("6");
  const [fulfillment, setFulfillment] = useState("0.75");
  const [margin, setMargin] = useState("20");

  const freightValue = noFreight ? 0 : Number(freight);
  const preview = computePreviewPrice(Number(cost), Number(units), freightValue, Number(insurance), Number(fulfillment), Number(margin));
  const comparison = competitorPrice ? computeCompetitorComparison(Number(cost), Number(units), freightValue, Number(insurance), Number(competitorPrice)) : null;

  return (
    <details className="mb-4 bg-surface border border-rule rounded-md">
      <summary className="cursor-pointer px-3 py-2.5 text-[13px] font-bold text-ink">🧮 Calculadora de precio</summary>
      <div className="px-3 pb-3">
        <div className="text-[12px] text-steel mb-3">
          La misma de Análisis de Mercado: pon el costo del proveedor y te saca el precio de Dropi. Si pones el precio de la competencia, te dice qué margen te quedaría. Solo es para sacar cuentas, no guarda nada.
        </div>

        <div className="mb-3 bg-cloud border border-rule rounded-md p-3">
          <div className="text-[12px] font-semibold text-steel mb-2">Proveedor</div>
          <div className="grid grid-cols-3 gap-2">
            <input className="rounded border border-rule px-2.5 py-1.5 text-[13px]" placeholder="Costo unitario (USD)" type="number" step="0.01" value={cost} onChange={(e) => setCost(e.target.value)} />
            <input className="rounded border border-rule px-2.5 py-1.5 text-[13px]" placeholder="Unidades del lote" type="number" value={units} onChange={(e) => setUnits(e.target.value)} />
            <input
              className="rounded border border-rule px-2.5 py-1.5 text-[13px] disabled:bg-cloud disabled:text-steel"
              placeholder="Flete del lote (USD)"
              type="number"
              step="0.01"
              value={noFreight ? "" : freight}
              disabled={noFreight}
              onChange={(e) => setFreight(e.target.value)}
            />
          </div>
          <label className="mt-2 flex items-center gap-2 text-[12px] text-steel cursor-pointer">
            <input type="checkbox" checked={noFreight} onChange={(e) => setNoFreight(e.target.checked)} />
            Este proveedor no cobra flete
          </label>
        </div>

        <div className="mb-3 bg-cloud border border-rule rounded-md p-3">
          <div className="text-[12px] font-semibold text-steel mb-2">Competencia (opcional)</div>
          <input className="w-full rounded border border-rule px-2.5 py-1.5 text-[13px]" placeholder="Precio de venta de la competencia" type="number" step="0.01" value={competitorPrice} onChange={(e) => setCompetitorPrice(e.target.value)} />
          {competitorPrice && preview !== null && (
            <div className="mt-2.5 pt-2.5 border-t border-rule text-[12px] space-y-1">
              <div className="text-ink">
                Tu precio de Dropi: <b>{money(preview)}</b> vs competencia: <b>{money(Number(competitorPrice))}</b>
                {" — "}
                {preview <= Number(competitorPrice) ? (
                  <span className="text-teal font-semibold">{money(Number(competitorPrice) - preview)} más barato</span>
                ) : (
                  <span className="text-red font-semibold">{money(preview - Number(competitorPrice))} más caro</span>
                )}
              </div>
              {comparison && (
                <div className="text-steel">
                  Margen si vendieras al precio de la competencia: entre{" "}
                  <b className={comparison.marginMin >= Number(margin) ? "text-teal" : "text-red"}>{comparison.marginMin.toFixed(1)}%</b>
                  {" y "}
                  <b className={comparison.marginMax >= Number(margin) ? "text-teal" : "text-red"}>{comparison.marginMax.toFixed(1)}%</b>
                  {" "}(tu margen mínimo pedido: {margin}%)
                </div>
              )}
            </div>
          )}
        </div>

        <div className="bg-surface border border-rule rounded-md p-3">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-[12px] text-steel">Fulfillment:</span>
            <button type="button" className={`rounded border px-2 py-1 text-[11.5px] font-semibold cursor-pointer ${fulfillment === "0.75" ? "border-teal bg-teal/10 text-teal" : "border-rule text-steel"}`} onClick={() => setFulfillment("0.75")}>$0.75 (default)</button>
            <button type="button" className={`rounded border px-2 py-1 text-[11.5px] font-semibold cursor-pointer ${fulfillment === "0.50" ? "border-teal bg-teal/10 text-teal" : "border-rule text-steel"}`} onClick={() => setFulfillment("0.50")}>$0.50 (chico)</button>
          </div>
          <div className="grid grid-cols-2 gap-2 mb-2">
            <div>
              <label className="text-[11px] text-steel">% de seguro</label>
              <input className="w-full rounded border border-rule px-2 py-1 text-[13px]" type="number" step="0.1" value={insurance} onChange={(e) => setInsurance(e.target.value)} />
            </div>
            <div>
              <label className="text-[11px] text-steel">Margen mínimo %</label>
              <input className="w-full rounded border border-rule px-2 py-1 text-[13px]" type="number" step="0.1" value={margin} onChange={(e) => setMargin(e.target.value)} />
            </div>
          </div>
          <div className="text-[13px] font-bold text-ink">
            Precio de Dropi (estimado): {preview !== null ? money(preview) : "—"}
          </div>
        </div>
      </div>
    </details>
  );
}
