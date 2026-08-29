"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2, Pencil, ChevronDown, ChevronUp, ShieldCheck } from "lucide-react";
import { formatWeekShort } from "@/components/dashboard/WeeklyTrendChart";
import { ProductMatchPicker, type ProductMatchResult } from "@/components/merchandise-reentry/ProductMatchPicker";
import { CatalogCode } from "@/components/shared/CatalogCode";

export type StockoutWeekRowDTO = {
  id: string;
  week: string;
  product: { id: string; name: string; catalogItem: { justCode: string | null } | null };
};

function formatWeekLabel(week: string) {
  if (!week) return "";
  const [year] = week.split("-W");
  return `${formatWeekShort(week)} · ${year}`;
}

export function StockoutPanel({
  weekRows,
  confirmedWeeks = [],
}: {
  weekRows: StockoutWeekRowDTO[];
  confirmedWeeks?: string[];
}) {
  const router = useRouter();
  const [week, setWeek] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [confirmedWeek, setConfirmedWeek] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);
  const [relinkingProductId, setRelinkingProductId] = useState<string | null>(null);

  // Confirmado 2026-08-29 (pedido explícito del usuario): el producto ya no
  // se escribe a mano — se busca en el mismo catálogo real (Just) que usan
  // Reingreso/Compras/Ventas Externas, mostrando su código tal cual aparece
  // en esas otras pantallas. Elegirlo del catálogo (reutilizando el mismo
  // StockoutProduct si ese producto ya se había marcado antes) y adjuntarlo
  // a la semana elegida sigue siendo una sola acción, en un clic.
  const handleAdd = async (result: ProductMatchResult) => {
    if (!week) {
      setErr("Elige una semana primero.");
      return;
    }
    setErr("");
    setBusy(true);

    const createRes = await fetch("/api/stockout-products", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ catalogItemId: result.id }),
    });
    if (!createRes.ok) {
      setBusy(false);
      const data = await createRes.json().catch(() => null);
      setErr(data?.error ?? "No se pudo guardar el producto.");
      return;
    }
    const product = await createRes.json();

    const res = await fetch("/api/stockout-weeks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ week, productId: product.id }),
    });
    setBusy(false);
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setErr(data?.error ?? "No se pudo guardar.");
      return;
    }
    setExpanded(false);
    router.refresh();
  };

  // Explicit "no hubo productos agotados esa semana" — separate from just
  // never touching the week, so the pendientes panel can tell "genuinely
  // nothing to report" apart from "nobody checked yet".
  const confirmEmpty = async () => {
    if (!week) {
      setErr("Elige una semana primero.");
      return;
    }
    setErr("");
    setBusy(true);
    const res = await fetch("/api/stockout-weeks/confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ week }),
    });
    setBusy(false);
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setErr(data?.error ?? "No se pudo confirmar.");
      return;
    }
    setConfirmedWeek(week);
    router.refresh();
  };

  const remove = async (id: string) => {
    if (!confirm("¿Eliminar esta semana de ruptura de stock?")) return;
    setBusy(true);
    await fetch(`/api/stockout-weeks/${id}`, { method: "DELETE" });
    setBusy(false);
    setConfirmingDeleteId(null);
    router.refresh();
  };

  // Re-vincula esta fila a otro producto del catálogo (corrige un match
  // equivocado) — actualiza el nombre mostrado en todas las semanas donde ya
  // aparece, en vez de requerir borrar y volver a crear.
  const saveRelink = async (result: ProductMatchResult) => {
    if (!relinkingProductId) return;
    setBusy(true);
    const res = await fetch(`/api/stockout-products/${relinkingProductId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ catalogItemId: result.id }),
    });
    setBusy(false);
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setErr(data?.error ?? "No se pudo vincular.");
      return;
    }
    setRelinkingProductId(null);
    router.refresh();
  };

  // Group rows by week for the compact/expanded list.
  const byWeek = new Map<string, StockoutWeekRowDTO[]>();
  for (const r of weekRows) {
    if (!byWeek.has(r.week)) byWeek.set(r.week, []);
    byWeek.get(r.week)!.push(r);
  }
  const weeks = [...byWeek.keys()].sort().reverse();
  const latestWeek = weeks[0] ?? null;

  return (
    <div>
      <div className="bg-surface border border-rule rounded-md p-4.5 mb-5">
        <label className="block mb-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-steel">
          Marcar un producto sin stock esa semana
        </label>
        <div className="flex items-start gap-2.5 flex-wrap">
          <div>
            <label className="block mb-1 text-[10px] text-steel">Semana</label>
            <input
              type="week"
              className="rounded border border-rule px-2.5 py-2 text-[13px] bg-surface"
              value={week}
              onChange={(e) => setWeek(e.target.value)}
            />
          </div>
          <div className="flex-1 min-w-[260px]">
            <label className="block mb-1 text-[10px] text-steel">Producto</label>
            {week ? (
              <ProductMatchPicker key={week} referencePhotoUrl={null} searchUrl="/api/stockout-catalog-search" onConfirm={handleAdd} />
            ) : (
              <div className="text-[12px] text-steel border border-dashed border-rule rounded px-2.5 py-2.5">Elige una semana primero.</div>
            )}
          </div>
        </div>
        {err && <div className="text-red text-[12.5px] mt-2.5">{err}</div>}
        <div className="text-[11px] text-steel mt-2.5">
          Buscá por nombre o código de Just — el mismo catálogo que usan Reingreso, Compras y Ventas Externas. Si el producto ya se había marcado antes, se reutiliza en vez de crear otro. Para marcar varios productos en la misma semana, repite la búsqueda una por una. El lápiz de cada producto corrige el vínculo en todas las semanas donde aparece.
        </div>

        <div className="border-t border-rule mt-3.5 pt-3.5">
          {week && (byWeek.has(week) || confirmedWeeks.includes(week) || confirmedWeek === week) ? (
            <div className="inline-flex items-center gap-1.5 text-[12px] text-teal">
              <ShieldCheck size={13} />
              {byWeek.has(week) ? "Esa semana ya tiene productos marcados." : "Ya confirmaste que esa semana no hubo productos."}
            </div>
          ) : (
            <button
              type="button"
              disabled={busy || !week}
              className="inline-flex items-center gap-1.5 rounded border border-rule px-3.5 py-2 text-[12.5px] font-semibold text-steel hover:text-ink hover:border-teal cursor-pointer disabled:opacity-60"
              onClick={confirmEmpty}
            >
              <ShieldCheck size={14} /> Confirmar: sin productos agotados esa semana
            </button>
          )}
        </div>
      </div>

      {weeks.length === 0 && (
        <div className="border-[1.5px] border-dashed border-rule rounded-md p-8.5 text-center text-steel text-[13.5px]">
          Aún no hay ninguna semana cargada.
        </div>
      )}

      {latestWeek && (
        <div>
          <button
            type="button"
            className="w-full flex items-center justify-between gap-3 bg-surface border border-rule rounded p-3.5 mb-2.5 cursor-pointer"
            onClick={() => setExpanded((v) => !v)}
          >
            {!expanded ? (
              <div className="flex items-center gap-3">
                <span className="font-semibold text-[13.5px]">{formatWeekLabel(latestWeek)}</span>
                <span className="text-[12.5px] text-steel">
                  {byWeek.get(latestWeek)!.length} producto{byWeek.get(latestWeek)!.length === 1 ? "" : "s"} · última semana
                </span>
              </div>
            ) : (
              <span className="text-[13px] font-semibold">{weeks.length} semanas cargadas</span>
            )}
            <span className="inline-flex items-center gap-1 text-[12px] font-semibold text-blue shrink-0">
              {expanded ? "Ocultar" : `Desplegar todas las semanas (${weeks.length})`}
              {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </span>
          </button>

          {expanded &&
            weeks.map((w) => (
              <div key={w} className="bg-surface border border-rule rounded p-3.5 mb-2.5">
                <div className="font-semibold text-[13px] mb-2">{formatWeekLabel(w)}</div>
                <div className="flex flex-wrap gap-2">
                  {byWeek.get(w)!.map((r) =>
                    relinkingProductId === r.product.id ? (
                      <div key={r.id} className="w-full sm:w-96">
                        <ProductMatchPicker
                          referencePhotoUrl={null}
                          searchUrl="/api/stockout-catalog-search"
                          onConfirm={saveRelink}
                          onCancel={() => setRelinkingProductId(null)}
                        />
                      </div>
                    ) : (
                      <span key={r.id} className="inline-flex items-center gap-1.5 text-[12px] bg-cloud border border-rule rounded-full px-2.5 py-1">
                        <CatalogCode code={r.product.catalogItem?.justCode ?? null} size="text-[10px]" />
                        <span>{r.product.name}</span>
                        {confirmingDeleteId === r.id ? (
                          <span className="flex items-center gap-1">
                            <button type="button" disabled={busy} className="text-red font-semibold cursor-pointer" onClick={() => remove(r.id)}>
                              Sí
                            </button>
                            <button type="button" className="text-steel cursor-pointer" onClick={() => setConfirmingDeleteId(null)}>
                              No
                            </button>
                          </span>
                        ) : (
                          <span className="flex items-center gap-1">
                            <button
                              type="button"
                              className="text-steel hover:text-blue cursor-pointer"
                              onClick={() => {
                                setRelinkingProductId(r.product.id);
                                setErr("");
                              }}
                              aria-label="Cambiar el producto vinculado"
                            >
                              <Pencil size={11} />
                            </button>
                            <button type="button" className="text-steel hover:text-red cursor-pointer" onClick={() => setConfirmingDeleteId(r.id)} aria-label="Quitar de esta semana">
                              <Trash2 size={11} />
                            </button>
                          </span>
                        )}
                      </span>
                    )
                  )}
                </div>
              </div>
            ))}
        </div>
      )}
    </div>
  );
}
