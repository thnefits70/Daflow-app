"use client";

import { useEffect, useState } from "react";
import { Clock, TriangleAlert } from "lucide-react";
import { COMBO_BRAND_LABELS } from "@/components/shared/ComboBrandInfo";
import { CatalogCode } from "@/components/shared/CatalogCode";
import { ExpandableName } from "@/components/ui/ExpandableName";

type MissingBrandCombo = {
  id: string;
  code: string;
  label: string | null;
  components: { quantity: number; name: string; justCode: string | null; photo: string | null }[];
};

// Pedido del usuario 2026-10-10: si un combo se vendió en Dropi sin marca,
// el pedido sale igual, pero la asesora B2B no puede seguir usando DAFLOW
// hasta elegir su marca — así esa información nunca queda faltando para los
// demás flujos. Doble confirmación (pedido del usuario) porque una vez puesta
// solo el admin puede cambiarla.
export function ComboBrandGate() {
  const [queue, setQueue] = useState<MissingBrandCombo[]>([]);
  const [picked, setPicked] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    fetch("/api/dropi-combos/missing-brand")
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((d) => setQueue(d.items ?? []))
      .catch(() => {});
  }, []);

  const current = queue[0];
  if (!current) return null;
  const code = current.code.startsWith("R") ? `Rocket ${current.code.slice(1)}` : current.code;

  async function confirm() {
    if (!picked) return;
    setSaving(true);
    setErr("");
    const res = await fetch(`/api/dropi-combos/${current.id}/bodega`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bodega: picked }),
    });
    const json = await res.json().catch(() => null);
    setSaving(false);
    if (!res.ok) {
      setErr(json?.error ?? "No se pudo guardar la marca.");
      return;
    }
    setPicked(null);
    setQueue((q) => q.slice(1));
  }

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/70 p-4">
      <div className="bg-surface border border-rule rounded-lg p-5 w-full max-w-md max-h-[90vh] overflow-y-auto">
        <div className="flex items-center gap-2 text-gold text-[12px] font-semibold uppercase tracking-wide mb-2">
          <TriangleAlert size={15} /> Marca obligatoria{queue.length > 1 ? ` · ${queue.length} combos` : ""}
        </div>
        <div className="text-[15px] font-bold text-ink mb-1 flex items-center gap-1.5 flex-wrap">
          Combo <span className="font-mono">{code}</span> sin marca
        </div>
        {current.label && <div className="text-[12px] text-steel mb-1">{current.label}</div>}
        <div className="text-[12.5px] text-steel mb-3 leading-relaxed">
          Este combo se vendió en Dropi sin marca. Elige a qué marca pertenece: es la cuenta de Dropi donde se publicó. Para seguir usando DAFLOW tienes que
          responder.
        </div>
        <div className="flex flex-col gap-1.5 mb-3">
          {current.components.map((c, i) => (
            <div key={i} className="flex items-center gap-2 bg-cloud border border-rule rounded-md p-1.5">
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

        {!picked ? (
          <div className="flex flex-col gap-1.5">
            {Object.entries(COMBO_BRAND_LABELS).map(([k, label]) => (
              <button
                key={k}
                type="button"
                className="rounded border border-rule px-3 py-2 text-[12.5px] font-semibold text-left cursor-pointer hover:border-teal"
                onClick={() => setPicked(k)}
              >
                {label}
              </button>
            ))}
          </div>
        ) : (
          <div className="rounded-md border border-gold/60 bg-gold/10 p-3">
            <div className="text-[12.5px] mb-2.5">
              ¿Confirmas que el combo <span className="font-mono font-bold">{code}</span> es de{" "}
              <span className="font-bold">{COMBO_BRAND_LABELS[picked]}</span>? Una vez guardada no podrás cambiarla; si te equivocas, solo el
              administrador la corrige.
            </div>
            {err && <div className="text-red text-[11.5px] mb-2">{err}</div>}
            <div className="flex gap-2">
              <button type="button" disabled={saving} className="flex-1 rounded border border-teal bg-teal px-3 py-1.5 text-[12px] font-bold text-navy cursor-pointer disabled:opacity-60" onClick={confirm}>
                {saving ? "Guardando…" : `Sí, es de ${COMBO_BRAND_LABELS[picked]}`}
              </button>
              <button type="button" disabled={saving} className="flex-1 rounded border border-rule px-3 py-1.5 text-[12px] font-semibold cursor-pointer" onClick={() => setPicked(null)}>
                No, volver
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
