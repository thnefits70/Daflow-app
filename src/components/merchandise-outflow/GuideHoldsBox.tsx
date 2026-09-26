"use client";

import { CatalogCode } from "@/components/shared/CatalogCode";
import { carrierLabel } from "@/lib/carriers";
import { computeGuideHolds } from "@/lib/fulfillmentHolds";
import type { CompiledLot } from "./LotView";

// Pedido de Daniel 2026-09-26: si de un producto salió menos de lo pedido,
// qué guías se quedan (las de la transportadora que sale al último primero)
// — para que Fulfillment sepa cuáles retener. Lo ven todos los que abren el
// corte; a Fulfillment además le llega el aviso cuando Daniel confirma.
export function GuideHoldsBox({ lot }: { lot: CompiledLot }) {
  const holds = computeGuideHolds(lot);
  if (holds.length === 0) return null;
  return (
    <div className="text-[11.5px] rounded-md p-2.5 mb-3 border" style={{ borderColor: "var(--color-gold)", background: "color-mix(in srgb, var(--color-gold) 12%, transparent)" }}>
      <div className="font-semibold mb-1">Guías a retener — falta stock ({holds.length})</div>
      {holds.map((h) => (
        <div key={h.catalogItemId} className="mb-1.5">
          <div className="flex items-center gap-1.5 flex-wrap">
            <CatalogCode code={h.justCode} />
            <span className="flex-1 min-w-0">{h.name}</span>
            <span className="font-mono">
              pedido {h.needed} · salen {h.out} · faltan {h.missing}
            </span>
          </div>
          <div className="pl-2 mt-0.5">
            {h.byCarrier.map((c) => (
              <div key={c.carrier}>
                ↳ Retener <b>{c.qty}</b> guía(s) de <b>{carrierLabel(c.carrier)}</b> que llevan este producto
              </div>
            ))}
            {h.warrantyGuides.map((w) => (
              <div key={w.guide}>
                ↳ Retener la garantía <b className="font-mono">{w.guide}</b> ({carrierLabel(w.carrier)}
                {w.qty > 1 ? `, ${w.qty} u.` : ""})
              </div>
            ))}
          </div>
          {!h.final && <div className="text-[10.5px] text-steel pl-2">Según lo que registró el equipo — falta que Daniel confirme.</div>}
        </div>
      ))}
      <div className="text-[10.5px] text-steel mt-1">
        Se retienen primero las guías de la transportadora que sale al último (Servientrega, luego Laar, Gintracom, Urbano y Veloces), así lo que se va antes sale completo. Si una guía lleva 2 o más unidades de este producto, cuenta por esas unidades.
      </div>
    </div>
  );
}
