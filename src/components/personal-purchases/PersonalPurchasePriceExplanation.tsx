"use client";

import { useState } from "react";
import type { ItemPriceExplanation } from "@/lib/personalPurchases";

function money(n: number) {
  return `$${n.toFixed(2)}`;
}

// Pedido del usuario 2026-10-03 (caso Joel, cinturón $5.39): en la misma
// tarjeta, por qué cada unidad salió a costo o Dropi y cómo se armó el
// Precio Dropi. Plegado por defecto para no alargar la lista.
export function PersonalPurchasePriceExplanation({
  explanation,
  costUnitPrice,
  dropiUnitPrice,
  itemTotal,
}: {
  explanation: ItemPriceExplanation | null;
  costUnitPrice: number | null;
  dropiUnitPrice: number | null;
  itemTotal: number | null;
}) {
  const [open, setOpen] = useState(false);
  if (!explanation || explanation.units.length === 0) return null;
  const { units, dropiSteps } = explanation;

  return (
    <div className="mt-1">
      <button type="button" className="text-[11.5px] font-semibold cursor-pointer text-teal" onClick={() => setOpen((v) => !v)}>
        {open ? "Ocultar explicación" : "¿Por qué este precio?"}
      </button>
      {open && (
        <div className="mt-1.5 rounded-md border border-rule bg-bg px-3 py-2.5 text-[12px] flex flex-col gap-2">
          {units.map((u, i) => (
            <div key={i}>
              <div className="font-semibold">
                Unidad {i + 1} · {u.who} →{" "}
                <span style={{ color: u.mode === "COST" ? "#22C55E" : "#D9A441" }}>
                  {u.mode === "COST" ? `al costo${costUnitPrice ? ` ${money(costUnitPrice)}` : ""}` : `precio Dropi${dropiUnitPrice ? ` ${money(dropiUnitPrice)}` : ""}`}
                </span>
              </div>
              <div className="text-steel-dim">{u.reason}</div>
            </div>
          ))}

          {dropiSteps && (
            <div className="pt-2 border-t border-rule">
              <div className="font-semibold mb-1">Cómo sale el precio Dropi (igual que en Stock Actual)</div>
              <div className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-0.5 tabular-nums">
                <span className="text-steel-dim">Costo puesto en bodega</span><span>{money(dropiSteps.bodega)}</span>
                <span className="text-steel-dim">+ Seguro {dropiSteps.insuranceRatePercent}%</span><span>{money(dropiSteps.withInsurance)}</span>
                <span className="text-steel-dim">+ Fulfillment {money(dropiSteps.fulfillmentCost)}</span><span>{money(dropiSteps.withFulfillment)}</span>
                <span className="text-steel-dim">÷ (1 − {dropiSteps.marginPercent}% de margen)</span><span className="font-bold">{money(dropiSteps.dropi)}</span>
              </div>
            </div>
          )}

          {itemTotal != null && units.length > 1 && (
            <div className="pt-2 border-t border-rule font-semibold tabular-nums">Total del producto: {money(itemTotal)}</div>
          )}
        </div>
      )}
    </div>
  );
}
