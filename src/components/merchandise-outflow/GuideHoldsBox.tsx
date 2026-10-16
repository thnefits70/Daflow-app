"use client";

import { useState } from "react";
import { CatalogCode } from "@/components/shared/CatalogCode";
import { carrierLabel } from "@/lib/carriers";
import { computeGuideHolds } from "@/lib/fulfillmentHolds";
import type { CompiledLot } from "./LotView";

function fmtShort(iso: string) {
  return new Date(iso).toLocaleString("es-EC", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "America/Guayaquil" });
}

// Pedido de Daniel 2026-09-26: si de un producto salió menos de lo pedido,
// qué guías se quedan (las de la transportadora que sale al último primero)
// — para que Fulfillment sepa cuáles retener. Lo ven todos los que abren el
// corte; a Fulfillment además le llega el aviso cuando Daniel confirma.
// 2026-10-16: Daniel o Allan marcan "Retuve esta guía" y luego "Ya salió";
// Pedidos despachados la cuenta el día en que salió.
export function GuideHoldsBox({ lot, onChanged }: { lot: CompiledLot; onChanged: () => void }) {
  const holds = computeGuideHolds(lot);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const held = new Map((lot.heldGuides ?? []).map((h) => [h.guideNumber.toUpperCase(), h]));
  const canAct = !!lot.viewer?.canRetainGuides;
  // Retenidas de este corte que ya no salen en la sugerencia (p. ej. Daniel
  // corrigió lo que salió): igual se ven para poder marcar "Ya salió".
  const suggested = new Set(holds.flatMap((h) => h.byCarrier.flatMap((c) => c.guides.map((g) => g.guide.toUpperCase()))));
  const extraHeld = (lot.heldGuides ?? []).filter((h) => !suggested.has(h.guideNumber.toUpperCase()));
  if (holds.length === 0 && extraHeld.length === 0) return null;

  async function act(action: "retain" | "release" | "undo", guideNumber: string, catalogItemId?: string) {
    setBusy(guideNumber);
    setErr(null);
    const r = await fetch(`/api/fulfillment-lots/${lot.id}/holds`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, guideNumber, catalogItemId }) });
    const j = await r.json().catch(() => ({}));
    setBusy(null);
    if (!r.ok) setErr(j.error ?? "No se pudo guardar.");
    else onChanged();
  }

  function guideState(guide: string, catalogItemId: string) {
    const h = held.get(guide.toUpperCase());
    const btn = "ml-1 rounded border px-1.5 py-0.5 text-[10.5px] font-semibold cursor-pointer disabled:opacity-50";
    if (h?.releasedAt) return <span className="ml-1 text-[10.5px] text-green font-semibold">✓ salió {fmtShort(h.releasedAt)}</span>;
    if (h) {
      return (
        <span className="ml-1 text-[10.5px]">
          <span className="text-gold font-semibold">retenida{h.retainedByName ? ` (${h.retainedByName})` : ""} · sale sola el {h.outDay.split("-").reverse().slice(0, 2).join("/")}</span>
          {canAct && (
            <>
              <button type="button" disabled={busy === guide} className={`${btn} border-teal text-teal`} onClick={() => act("release", guide)}>Ya salió</button>
              <button type="button" disabled={busy === guide} className="ml-1 text-steel underline cursor-pointer text-[10.5px]" onClick={() => act("undo", guide)}>deshacer</button>
            </>
          )}
        </span>
      );
    }
    if (!canAct) return null;
    return <button type="button" disabled={busy === guide} className={`${btn} border-gold`} onClick={() => act("retain", guide, catalogItemId)}>Retuve esta guía</button>;
  }

  return (
    <div className="text-[11.5px] rounded-md p-2.5 mb-3 border" style={{ borderColor: "var(--color-gold)", background: "color-mix(in srgb, var(--color-gold) 12%, transparent)" }}>
      <div className="font-semibold mb-1">Guías a retener — falta stock ({holds.length})</div>
      {err && <div className="text-red mb-1">{err}</div>}
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
            {h.byCarrier.map((c) =>
              c.guides.length > 0 ? (
                <div key={c.carrier}>
                  ↳ Retener de <b>{carrierLabel(c.carrier)}</b>:
                  {c.guides.map((g) => (
                    <div key={g.guide} className="pl-3 flex flex-wrap items-center gap-y-0.5">
                      <b className="font-mono">{g.guide}</b>
                      <span className="ml-1">{g.city ? `(${g.city}${g.qty > 1 ? `, ${g.qty} u.` : ""})` : g.qty > 1 ? `(${g.qty} u.)` : ""}</span>
                      {h.final && guideState(g.guide, h.catalogItemId)}
                    </div>
                  ))}
                </div>
              ) : (
                <div key={c.carrier}>
                  ↳ Retener <b>{c.qty}</b> guía(s) de <b>{carrierLabel(c.carrier)}</b> que llevan este producto
                </div>
              ),
            )}
            {h.warrantyGuides.map((w) => (
              <div key={w.guide}>
                ↳ Retener la garantía <b className="font-mono">{w.guide}</b> ({carrierLabel(w.carrier)}
                {w.qty > 1 ? `, ${w.qty} u.` : ""})
              </div>
            ))}
          </div>
          {!h.final && <div className="text-[10.5px] text-steel pl-2">Según lo que registró el equipo — falta que Daniel confirme. Después se marcan las guías retenidas.</div>}
        </div>
      ))}
      {extraHeld.length > 0 && (
        <div className="mb-1.5">
          <div className="font-semibold">Otras guías retenidas de este corte</div>
          {extraHeld.map((h) => (
            <div key={h.guideNumber} className="pl-3 flex flex-wrap items-center">
              <b className="font-mono">{h.guideNumber}</b>
              {guideState(h.guideNumber, h.catalogItemId)}
            </div>
          ))}
        </div>
      )}
      <div className="text-[10.5px] text-steel mt-1">
        Se retienen primero las guías de la transportadora que sale al último (Servientrega, luego Laar, Gintracom, Urbano y Veloces), así lo que se va antes sale completo. Dentro de cada transportadora se retienen las de las ciudades más cercanas a Guayaquil: las lejanas salen primero. Si una guía lleva 2 o más unidades de este producto, cuenta por esas unidades. Una guía retenida cuenta en Pedidos despachados el día de trabajo siguiente; si salió otro día, pulsa «Ya salió» ese día.
      </div>
    </div>
  );
}
