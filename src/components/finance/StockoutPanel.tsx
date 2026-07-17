"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, ChevronDown, ChevronUp } from "lucide-react";
import { formatWeekShort } from "@/components/dashboard/WeeklyTrendChart";

export type StockoutProductDTO = { id: string; name: string };
export type StockoutWeekRowDTO = { id: string; week: string; product: { id: string; name: string } };

function formatWeekLabel(week: string) {
  if (!week) return "";
  const [year] = week.split("-W");
  return `${formatWeekShort(week)} · ${year}`;
}

export function StockoutPanel({
  products,
  weekRows,
}: {
  products: StockoutProductDTO[];
  weekRows: StockoutWeekRowDTO[];
}) {
  const router = useRouter();
  const [week, setWeek] = useState("");
  const [productName, setProductName] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [expanded, setExpanded] = useState(false);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);

  // Single action: identify the product by name (reusing it if it already
  // exists, case-insensitively — never a second "+ Producto nuevo" step) and
  // attach it to the chosen week, in one click. Doing this any other way let
  // someone create several new products in a row and only ever attach the
  // last one, since creating and attaching used to be two separate buttons.
  const addToWeek = async () => {
    const name = productName.trim();
    if (!week || !name) {
      setErr("Elige una semana y escribe un producto.");
      return;
    }
    setErr("");
    setBusy(true);

    const existing = products.find((p) => p.name.toLowerCase() === name.toLowerCase());
    let productId = existing?.id;

    if (!productId) {
      const createRes = await fetch("/api/stockout-products", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!createRes.ok) {
        setBusy(false);
        const data = await createRes.json().catch(() => null);
        setErr(data?.error ?? "No se pudo crear el producto.");
        return;
      }
      productId = (await createRes.json()).id;
    }

    const res = await fetch("/api/stockout-weeks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ week, productId }),
    });
    setBusy(false);
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setErr(data?.error ?? "No se pudo guardar.");
      return;
    }
    setProductName("");
    setExpanded(false);
    router.refresh();
  };

  const remove = async (id: string) => {
    setBusy(true);
    await fetch(`/api/stockout-weeks/${id}`, { method: "DELETE" });
    setBusy(false);
    setConfirmingDeleteId(null);
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
        <div className="flex items-end gap-2.5 flex-wrap">
          <div>
            <label className="block mb-1 text-[10px] text-steel">Semana</label>
            <input
              type="week"
              className="rounded border border-rule px-2.5 py-2 text-[13px] bg-surface"
              value={week}
              onChange={(e) => setWeek(e.target.value)}
            />
          </div>
          <div>
            <label className="block mb-1 text-[10px] text-steel">Producto</label>
            <input
              list="stockout-products-datalist"
              className="rounded border border-rule px-2.5 py-2 text-[13px] bg-surface min-w-[220px]"
              placeholder="Escribe o elige un producto…"
              value={productName}
              onChange={(e) => setProductName(e.target.value)}
            />
            <datalist id="stockout-products-datalist">
              {products.map((p) => (
                <option key={p.id} value={p.name} />
              ))}
            </datalist>
          </div>
          <button
            type="button"
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded border border-blue bg-blue px-3.5 py-2 text-[12.5px] font-semibold text-white cursor-pointer disabled:opacity-60"
            onClick={addToWeek}
          >
            <Plus size={14} /> Guardar
          </button>
        </div>
        {err && <div className="text-red text-[12.5px] mt-2.5">{err}</div>}
        <div className="text-[11px] text-steel mt-2.5">
          Si el producto ya existe, escribe su nombre igual y se reutiliza. Para marcar varios productos en la misma semana, repite Guardar uno por uno.
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
                  {byWeek.get(w)!.map((r) => (
                    <span key={r.id} className="inline-flex items-center gap-1.5 text-[12px] bg-cloud border border-rule rounded-full px-2.5 py-1">
                      {r.product.name}
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
                        <button type="button" className="text-steel hover:text-red cursor-pointer" onClick={() => setConfirmingDeleteId(r.id)}>
                          <Trash2 size={11} />
                        </button>
                      )}
                    </span>
                  ))}
                </div>
              </div>
            ))}
        </div>
      )}
    </div>
  );
}
