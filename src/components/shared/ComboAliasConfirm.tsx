"use client";

import { AlertTriangle, Clock } from "lucide-react";
import { COMBO_BRAND_LABELS } from "@/components/shared/ComboBrandInfo";
import { CatalogCode } from "@/components/shared/CatalogCode";
import { ExpandableName } from "@/components/ui/ExpandableName";

export type AliasMother = {
  code: string;
  label: string | null;
  bodega: string | null;
  components: { quantity: number; name: string; justCode: string | null; photo: string | null }[];
};

// Pedido del usuario 2026-10-10: DAFLOW nunca une dos IDs de combo solo.
// Si la receta escrita es idéntica a un combo que ya existe, se muestra cuál
// es y una persona confirma: si es el mismo, el ID nuevo apunta a ese y toma
// su marca; si no, se equivocó en la receta y vuelve a corregirla.
export function ComboAliasConfirm({
  newCode,
  mother,
  busy,
  onConfirm,
  onReject,
}: {
  newCode: string;
  mother: AliasMother;
  busy: boolean;
  onConfirm: () => void;
  onReject: () => void;
}) {
  const brand = mother.bodega ? COMBO_BRAND_LABELS[mother.bodega] ?? mother.bodega : "sin marca";
  return (
    <div className="bg-cloud rounded-md p-3 border border-gold/60">
      <div className="text-[12px] font-bold mb-1.5 flex items-center gap-1.5 text-gold">
        <AlertTriangle size={13} /> Este combo ya existe
      </div>
      <div className="text-[11.5px] mb-2">
        Los productos que escribiste son exactamente los del combo <span className="font-mono font-bold">{mother.code}</span> ({brand})
        {mother.label && <> — {mother.label}</>}:
      </div>
      <div className="flex flex-col gap-1.5 mb-2.5">
        {mother.components.map((c, i) => (
          <div key={i} className="flex items-center gap-2 bg-surface border border-rule rounded-md p-1.5">
            {c.photo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img loading="lazy" decoding="async" src={c.photo} alt="" className="w-8 h-8 object-cover rounded border border-rule shrink-0" />
            ) : (
              <div className="w-8 h-8 rounded border border-dashed border-rule shrink-0 flex items-center justify-center text-steel">
                <Clock size={12} />
              </div>
            )}
            {c.justCode && <CatalogCode code={c.justCode} />}
            <ExpandableName text={c.name} className="flex-1 text-[11.5px]" />
            <span className="font-mono text-[12px] font-bold text-teal shrink-0">{c.quantity}×</span>
          </div>
        ))}
      </div>
      <div className="text-[11.5px] mb-2.5">
        ¿El <span className="font-mono font-bold">{newCode}</span> es este mismo combo? Si dices que sí, quedará unido al {mother.code} y llevará su marca ({brand}).
      </div>
      <div className="flex gap-2">
        <button type="button" disabled={busy} className="flex-1 rounded border border-teal bg-teal px-3 py-1.5 text-[12px] font-bold text-navy cursor-pointer disabled:opacity-60" onClick={onConfirm}>
          {busy ? "Guardando…" : "Sí, es el mismo combo"}
        </button>
        <button type="button" disabled={busy} className="flex-1 rounded border border-rule px-3 py-1.5 text-[12px] font-semibold cursor-pointer" onClick={onReject}>
          No, me equivoqué — corregir
        </button>
      </div>
    </div>
  );
}
