"use client";

import { useState } from "react";
import { AlertTriangle, Clock } from "lucide-react";
import { ComboComponentBuilder, type ComboDraftComponent } from "@/components/merchandise-reentry/ComboComponentBuilder";
import { CatalogCode } from "@/components/shared/CatalogCode";

export type RegisteredCombo = { id: string; code: string; label: string | null; componentsCount: number };

// Confirmado 2026-09-21, pedido explícito del usuario: Yair (Fulfillment)
// conoce de primera mano qué productos reales trae un combo — puede
// registrar la receta él mismo, sin pasar por Daniel, con doble
// confirmación (revisa el resumen completo antes de guardar) para que no
// se equivoque al escribir qué productos van en cada combo.
export function RegisterComboForm({
  initialCode,
  initialLabel = "",
  onRegistered,
  onCancel,
}: {
  initialCode: string;
  initialLabel?: string;
  onRegistered: (combo: RegisteredCombo) => void;
  onCancel: () => void;
}) {
  const [code, setCode] = useState(initialCode);
  const [label, setLabel] = useState(initialLabel);
  const [components, setComponents] = useState<ComboDraftComponent[]>([]);
  const [reviewing, setReviewing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  async function save() {
    setSaving(true);
    setErr("");
    const res = await fetch("/api/fulfillment-requests/register-combo", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: code.trim(), label: label.trim() || undefined, components: components.map((c) => ({ catalogItemId: c.catalogItem.id, quantity: c.quantity })) }),
    });
    const json = await res.json().catch(() => null);
    setSaving(false);
    if (!res.ok) {
      setErr(json?.error ?? "No se pudo guardar la receta.");
      setReviewing(false);
      return;
    }
    onRegistered(json as RegisteredCombo);
  }

  if (reviewing) {
    return (
      <div className="bg-cloud rounded-md p-3">
        <div className="text-[12px] font-bold mb-2">Revisa antes de guardar</div>
        <div className="text-[11.5px] mb-2">
          Código: <span className="font-mono font-semibold">{code}</span>
          {label && <span> — {label}</span>}
        </div>
        <div className="flex flex-col gap-1.5 mb-3">
          {components.map((c) => (
            <div key={c.catalogItem.id} className="flex items-center gap-2 bg-surface border border-rule rounded-md p-1.5">
              {c.catalogItem.photos[0] ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={c.catalogItem.photos[0]} alt="" className="w-8 h-8 object-cover rounded border border-rule shrink-0" />
              ) : (
                <div className="w-8 h-8 rounded border border-dashed border-rule shrink-0 flex items-center justify-center text-steel">
                  <Clock size={12} />
                </div>
              )}
              <span className="flex-1 min-w-0 text-[11.5px] truncate">{c.catalogItem.name}</span>
              <span className="font-mono text-[12px] font-bold text-teal shrink-0">{c.quantity}×</span>
            </div>
          ))}
        </div>
        <div className="text-[11px] text-steel mb-2.5 flex items-start gap-1.5">
          <AlertTriangle size={12} className="mt-0.5 shrink-0" /> Confirma que estos son los productos reales y las cantidades correctas — esto queda como la receta oficial de este combo para toda la app.
        </div>
        {err && <div className="text-red text-[11.5px] mb-2">{err}</div>}
        <div className="flex gap-2">
          <button type="button" disabled={saving} className="flex-1 rounded border border-teal bg-teal px-3 py-1.5 text-[12px] font-bold text-navy cursor-pointer disabled:opacity-60" onClick={save}>
            {saving ? "Guardando…" : "Sí, guardar receta"}
          </button>
          <button type="button" className="flex-1 rounded border border-rule px-3 py-1.5 text-[12px] font-semibold cursor-pointer" onClick={() => setReviewing(false)}>
            Corregir
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-cloud rounded-md p-3">
      <div className="text-[12px] font-bold mb-2">Registrar receta de este combo</div>
      <div className="flex gap-2 mb-2">
        <div className="flex-1">
          <div className="text-[10px] text-steel mb-0.5">Código del combo (Dropi)</div>
          <div className="flex items-center gap-1">
            <input type="text" className="w-full rounded border border-rule bg-surface px-2.5 py-1.5 text-[12.5px] font-mono" value={code} onChange={(e) => setCode(e.target.value)} />
            {code && <CatalogCode code={code} />}
          </div>
        </div>
        <div className="flex-1">
          <div className="text-[10px] text-steel mb-0.5">Nombre de referencia (opcional)</div>
          <input type="text" className="w-full rounded border border-rule bg-surface px-2.5 py-1.5 text-[12.5px]" value={label} onChange={(e) => setLabel(e.target.value)} />
        </div>
      </div>
      <div className="text-[10px] text-steel mb-1.5">Agrega cada producto real que trae este combo y cuántas unidades:</div>
      <ComboComponentBuilder components={components} onChange={setComponents} searchUrl="/api/fulfillment-requests/catalog-search" />
      {err && <div className="text-red text-[11.5px] mt-2">{err}</div>}
      <div className="flex gap-2 mt-3">
        <button
          type="button"
          disabled={!code.trim() || components.length === 0}
          className="flex-1 rounded border border-teal bg-teal px-3 py-1.5 text-[12px] font-bold text-navy cursor-pointer disabled:opacity-50"
          onClick={() => setReviewing(true)}
        >
          Continuar
        </button>
        <button type="button" className="flex-1 rounded border border-rule px-3 py-1.5 text-[12px] font-semibold cursor-pointer" onClick={onCancel}>
          Cancelar
        </button>
      </div>
    </div>
  );
}
