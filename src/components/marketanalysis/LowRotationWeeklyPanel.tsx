"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { ProductMatchPicker, type ProductMatchResult } from "@/components/merchandise-reentry/ProductMatchPicker";
import { CatalogCode } from "@/components/shared/CatalogCode";

export const LOW_ROTATION_THRESHOLD = 8;

type Entry = { catalogItemId: string; name: string; justCode: string | null; unitsDispatched: number };

// Confirmado 2026-08-31: sábado, Daniel sube/actualiza la lista de productos
// que despacharon menos de 8 unidades esa semana — cada semana queda
// guardada aparte (nunca se sobrescribe una semana anterior), para llevar
// control de cuántas semanas seguidas lleva estancado cada producto.
export function LowRotationWeeklyPanel({ defaultWeekOf }: { defaultWeekOf: string }) {
  const router = useRouter();
  const [weekOf, setWeekOf] = useState(defaultWeekOf);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [picking, setPicking] = useState(false);
  const [pendingItem, setPendingItem] = useState<ProductMatchResult | null>(null);
  const [units, setUnits] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [saved, setSaved] = useState(false);

  function addEntry() {
    if (!pendingItem) return;
    const n = Number(units);
    if (!Number.isFinite(n) || n < 0) {
      setErr("Ingresa cuántas unidades despachó esa semana.");
      return;
    }
    if (n >= LOW_ROTATION_THRESHOLD) {
      setErr(`Este producto ya despachó ${n} — solo hace falta anotar los que están bajo ${LOW_ROTATION_THRESHOLD}.`);
      return;
    }
    setErr("");
    setEntries((prev) => [
      ...prev.filter((e) => e.catalogItemId !== pendingItem.id),
      { catalogItemId: pendingItem.id, name: pendingItem.name, justCode: pendingItem.justCode, unitsDispatched: n },
    ]);
    setPendingItem(null);
    setUnits("");
    setPicking(false);
  }

  async function save() {
    if (entries.length === 0) {
      setErr("Agrega al menos un producto.");
      return;
    }
    setErr("");
    setBusy(true);
    setSaved(false);
    const res = await fetch("/api/low-rotation-weekly", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        weekOf,
        entries: entries.map((e) => ({ catalogItemId: e.catalogItemId, unitsDispatched: e.unitsDispatched })),
      }),
    });
    const data = await res.json().catch(() => null);
    setBusy(false);
    if (!res.ok) {
      setErr(data?.error ?? "No se pudo guardar.");
      return;
    }
    setSaved(true);
    setEntries([]);
    router.refresh();
  }

  return (
    <div className="bg-surface border border-rule rounded-md p-4.5">
      <label className="block mb-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-steel">
        Productos con baja rotación esta semana
      </label>
      <div className="text-[11.5px] text-steel mb-2.5">
        Anota los productos que despacharon menos de {LOW_ROTATION_THRESHOLD} unidades esta semana, con la cantidad real. Se guarda como el registro de esta semana específica — las semanas anteriores no se pierden.
      </div>

      <div className="mb-3">
        <label className="block mb-1 text-[10px] text-steel">Semana (sábado)</label>
        <input
          type="date"
          className="rounded border border-rule px-2.5 py-2 text-[13px] bg-surface"
          value={weekOf}
          onChange={(e) => setWeekOf(e.target.value)}
        />
      </div>

      {entries.length > 0 && (
        <div className="flex flex-col gap-1.5 mb-3">
          {entries.map((e) => (
            <div key={e.catalogItemId} className="flex items-center gap-2 border border-rule rounded p-2 text-[12.5px]">
              <CatalogCode code={e.justCode} />
              <span className="flex-1">{e.name}</span>
              <span className="text-steel">{e.unitsDispatched} despachos</span>
              <button
                type="button"
                className="text-steel hover:text-red cursor-pointer"
                onClick={() => setEntries((prev) => prev.filter((x) => x.catalogItemId !== e.catalogItemId))}
                aria-label="Quitar"
              >
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </div>
      )}

      {picking ? (
        pendingItem ? (
          <div className="border border-rule rounded p-2.5 mb-2">
            <div className="text-[12.5px] font-semibold mb-1.5">{pendingItem.name}</div>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={0}
                autoFocus
                placeholder="Unidades despachadas"
                className="rounded border border-rule px-2.5 py-1.5 text-[12.5px] w-40"
                value={units}
                onChange={(e) => setUnits(e.target.value)}
              />
              <button type="button" className="rounded border border-teal bg-teal px-3 py-1.5 text-[12px] font-bold text-navy cursor-pointer" onClick={addEntry}>
                Agregar
              </button>
              <button type="button" className="text-[11px] text-steel cursor-pointer" onClick={() => setPendingItem(null)}>
                Cancelar
              </button>
            </div>
          </div>
        ) : (
          <ProductMatchPicker
            referencePhotoUrl={null}
            searchUrl="/api/combo-suggestions/catalog-search"
            onConfirm={setPendingItem}
            onCancel={() => setPicking(false)}
          />
        )
      ) : (
        <button
          type="button"
          className="rounded border border-rule px-3.5 py-2 text-[12.5px] font-semibold cursor-pointer hover:border-teal"
          onClick={() => setPicking(true)}
        >
          + Agregar producto
        </button>
      )}

      {err && <div className="text-red text-[12.5px] mt-2.5">{err}</div>}
      {saved && <div className="text-teal text-[12.5px] mt-2.5">Guardado.</div>}

      {entries.length > 0 && (
        <div className="mt-3.5">
          <button
            type="button"
            disabled={busy}
            className="rounded border border-teal bg-teal px-3.5 py-2 text-[12.5px] font-bold text-navy cursor-pointer disabled:opacity-60"
            onClick={save}
          >
            {busy ? "Guardando…" : `Guardar lista de la semana (${entries.length})`}
          </button>
        </div>
      )}
    </div>
  );
}
