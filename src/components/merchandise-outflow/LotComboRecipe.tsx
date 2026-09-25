"use client";

import { useState } from "react";
import { AlertTriangle, Pencil, X } from "lucide-react";
import { ComboComponentBuilder, type ComboDraftComponent } from "@/components/merchandise-reentry/ComboComponentBuilder";
import { CatalogCode } from "@/components/shared/CatalogCode";

export type LotComboRecipe = {
  id: string;
  code: string;
  label: string | null;
  components: { catalogItemId: string; name: string; photos: string[]; justCode: string | null; quantity: number }[];
};

type Part = { key: string; name: string; justCode: string | null; photo: string | undefined; quantity: number };

function PartList({ parts, tone }: { parts: Part[]; tone?: "old" }) {
  return (
    <div className="flex flex-col gap-1">
      {parts.map((p) => (
        <div key={p.key} className={`flex items-center gap-2 rounded-md border px-2 py-1 text-[11.5px] ${tone === "old" ? "border-red/30 bg-red/5" : "border-rule bg-surface"}`}>
          {p.photo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={p.photo} alt="" className="w-7 h-7 object-cover rounded border border-rule shrink-0" />
          ) : (
            <div className="w-7 h-7 rounded border border-dashed border-rule shrink-0" />
          )}
          <CatalogCode code={p.justCode} />
          <span className="flex-1 min-w-0">{p.name}</span>
          <span className="font-mono font-bold text-teal shrink-0">{p.quantity}×</span>
        </div>
      ))}
    </div>
  );
}

// Pedido del usuario 2026-09-25 (combo 157246 armado con la almohada
// equivocada): Yair ve cómo está guardada la receta del combo que le suma
// unidades a un producto y, si está mal, la corrige él mismo con doble
// confirmación (antes → ahora). Solo mientras el corte está en preparación
// — ver api/fulfillment-lots/[id]/combo-recipe.
export function LotComboRecipe({ lotId, combo, editable, onClose, onSaved }: { lotId: string; combo: LotComboRecipe; editable: boolean; onClose: () => void; onSaved: () => void }) {
  const [editing, setEditing] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [draft, setDraft] = useState<ComboDraftComponent[]>([]);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  const current: Part[] = combo.components.map((c) => ({ key: c.catalogItemId, name: c.name, justCode: c.justCode, photo: c.photos[0], quantity: c.quantity }));
  const next: Part[] = draft.map((c) => ({ key: c.catalogItem.id, name: c.catalogItem.name, justCode: c.catalogItem.justCode, photo: c.catalogItem.photos[0], quantity: c.quantity }));

  function startEdit() {
    setDraft(combo.components.map((c) => ({ catalogItem: { id: c.catalogItemId, name: c.name, photos: c.photos, justCode: c.justCode, pendingRegistration: false }, quantity: c.quantity })));
    setErr("");
    setEditing(true);
  }

  async function save() {
    setSaving(true);
    setErr("");
    const res = await fetch(`/api/fulfillment-lots/${lotId}/combo-recipe`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: combo.code, components: draft.map((c) => ({ catalogItemId: c.catalogItem.id, quantity: c.quantity })) }),
    });
    const json = await res.json().catch(() => null);
    setSaving(false);
    if (!res.ok) {
      setErr(json?.error ?? "No se pudo guardar la receta.");
      setReviewing(false);
      return;
    }
    if (json?.warning) window.alert(json.warning);
    onSaved();
  }

  return (
    <div className="bg-cloud border border-teal/40 rounded-md p-3 mb-3">
      <div className="flex items-start gap-2 mb-2">
        <div className="flex-1 min-w-0">
          <div className="text-[12.5px] font-bold flex items-center gap-1.5 flex-wrap">
            Receta del combo <CatalogCode code={combo.code} />
          </div>
          {combo.label && <div className="text-[11.5px] text-steel">{combo.label}</div>}
        </div>
        <button type="button" className="text-steel hover:text-ink cursor-pointer" onClick={onClose} title="Cerrar">
          <X size={14} />
        </button>
      </div>

      {!editing && (
        <>
          <div className="text-[11px] text-steel mb-1">Así está guardada — cada pedido de este combo saca:</div>
          <PartList parts={current} />
          {editable && (
            <button type="button" className="mt-2.5 flex items-center gap-1.5 rounded border border-rule px-3 py-1.5 text-[12px] font-semibold cursor-pointer hover:border-teal" onClick={startEdit}>
              <Pencil size={12} /> Corregir receta
            </button>
          )}
        </>
      )}

      {editing && !reviewing && (
        <>
          <div className="text-[11px] text-steel mb-1.5">Deja solo los productos reales que trae cada pedido de este combo y cuántas unidades de cada uno:</div>
          <ComboComponentBuilder components={draft} onChange={setDraft} searchUrl="/api/fulfillment-requests/catalog-search" />
          {err && <div className="text-red text-[11.5px] mt-2">{err}</div>}
          <div className="flex gap-2 mt-3">
            <button
              type="button"
              disabled={draft.length === 0 || draft.some((c) => c.quantity < 1)}
              className="flex-1 rounded border border-teal bg-teal px-3 py-1.5 text-[12px] font-bold text-navy cursor-pointer disabled:opacity-50"
              onClick={() => setReviewing(true)}
            >
              Continuar
            </button>
            <button type="button" className="flex-1 rounded border border-rule px-3 py-1.5 text-[12px] font-semibold cursor-pointer" onClick={() => setEditing(false)}>
              Cancelar
            </button>
          </div>
        </>
      )}

      {editing && reviewing && (
        <>
          <div className="text-[11px] font-semibold text-red mb-1">Antes</div>
          <PartList parts={current} tone="old" />
          <div className="text-[11px] font-semibold text-teal mt-2 mb-1">Ahora</div>
          <PartList parts={next} />
          <div className="text-[11px] text-steel mt-2.5 mb-2.5 flex items-start gap-1.5">
            <AlertTriangle size={12} className="mt-0.5 shrink-0" />
            Esta es la receta oficial del combo para toda la app (también el despacho de Inventario). Este corte se recalcula solo y a Daniel le llega un aviso con el antes y el ahora.
          </div>
          {err && <div className="text-red text-[11.5px] mb-2">{err}</div>}
          <div className="flex gap-2">
            <button type="button" disabled={saving} className="flex-1 rounded border border-teal bg-teal px-3 py-1.5 text-[12px] font-bold text-navy cursor-pointer disabled:opacity-60" onClick={save}>
              {saving ? "Guardando…" : "Sí, corregir receta"}
            </button>
            <button type="button" disabled={saving} className="flex-1 rounded border border-rule px-3 py-1.5 text-[12px] font-semibold cursor-pointer" onClick={() => setReviewing(false)}>
              Volver a editar
            </button>
          </div>
        </>
      )}
    </div>
  );
}
