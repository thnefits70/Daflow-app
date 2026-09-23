"use client";

import { useState } from "react";
import { computeMaxPurchasePrices, DROPI_FULFILLMENT_DEFAULT, DROPI_INSURANCE_DEFAULT, DROPI_MARGIN_DEFAULT } from "@/lib/dropiPricing";

const money = (n: number) => `$${n.toFixed(2)}`;

// Confirmado 2026-09-23 (idea de Jariel): precio máximo al que conviene
// comprar un Ganador no encontrado, en 3 escenarios de flete — ver
// computeMaxPurchasePrices. Sin precio de la competencia no hay de dónde
// partir: se avisa en vez de adivinarlo (una IA inventando el precio podría
// hacer negociar con un número falso).
export function MaxPurchasePrice({ competitorPrice }: { competitorPrice: number | null }) {
  const [open, setOpen] = useState(false);

  if (competitorPrice === null || competitorPrice <= 0) {
    return (
      <div className="text-[12px] text-gold mt-1.5">
        Falta el precio de la competencia — agrégalo con &quot;Editar&quot; para ver el precio máximo de compra.
      </div>
    );
  }

  const { targetSalePrice, scenarios } = computeMaxPurchasePrices(competitorPrice);
  if (scenarios.every((s) => s.maxCost === null)) {
    return <div className="text-[12px] text-red mt-1.5">No alcanza el margen: la competencia vende tan barato que no nos queda ganancia.</div>;
  }

  return (
    <div className="mt-1.5 rounded border border-rule bg-cloud px-2.5 py-2 text-[12px]">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <span className="font-semibold text-ink">Comprar a máximo:</span>
        {scenarios.map((s) => (
          <span key={s.key} className="text-steel">
            {s.label}{s.freightPercent > 0 ? ` (+${s.freightPercent}%)` : ""}:{" "}
            <b className={s.key === "normal" ? "text-teal text-[13px]" : "text-ink"}>{s.maxCost !== null ? money(s.maxCost) : "no alcanza"}</b>
          </span>
        ))}
      </div>
      <button type="button" className="text-[11.5px] text-blue underline decoration-dotted cursor-pointer mt-1" onClick={() => setOpen((v) => !v)}>
        {open ? "Ocultar cálculo" : "Ver cómo se calculó"}
      </button>
      {open && (
        <div className="mt-1.5 text-[11.5px] text-steel space-y-1">
          <div>
            Misma fórmula del Precio Dropi de Stock Actual (INVESTOCK): costo + flete, + {DROPI_INSURANCE_DEFAULT}% de garantía, + {money(DROPI_FULFILLMENT_DEFAULT)} de fulfillment, y {DROPI_MARGIN_DEFAULT}% de ganancia sobre el precio de venta.
          </div>
          <div>
            Competencia vende a <b className="text-ink">{money(competitorPrice)}</b> → nosotros como máximo a <b className="text-ink">{money(targetSalePrice)}</b> ($0.01 menos).
          </div>
          {scenarios.map((s) => s.maxCost !== null && s.salePrice !== null && (
            <div key={s.key}>
              <b className="text-ink">{s.label}:</b> compra {money(s.maxCost)}
              {s.freightPercent > 0 && <> + flete ~{money(s.freightPerUnit)}</>}
              {" "}+ {DROPI_INSURANCE_DEFAULT}% garantía + {money(DROPI_FULFILLMENT_DEFAULT)} fulfillment, + {DROPI_MARGIN_DEFAULT}% ganancia → vendemos a <b className="text-ink">{money(s.salePrice)}</b>
            </div>
          ))}
          <div>
            El flete sale de nuestras compras reales: cuando el proveedor lo cobra aparte suele ser ~2% del costo, y lo más alto visto fue ~8%. Si no sabes si lo cobrarán, negocia con el de &quot;flete normal&quot;.
          </div>
        </div>
      )}
    </div>
  );
}
