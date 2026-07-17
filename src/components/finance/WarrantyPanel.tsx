"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, Pencil, ChevronDown, ChevronUp } from "lucide-react";
import { formatMonthShort } from "@/components/dashboard/WeeklyTrendChart";
import { Combobox } from "@/components/ui/Combobox";

export type WarrantyCategoryDTO = { id: string; name: string };
export type WarrantyMonthTotalDTO = { id: string; month: string; total: number };
export type WarrantyCategoryMonthCountDTO = {
  id: string;
  month: string;
  count: number;
  category: { id: string; name: string };
};

function currentMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

export function WarrantyPanel({
  categories,
  monthTotals,
  counts,
}: {
  categories: WarrantyCategoryDTO[];
  monthTotals: WarrantyMonthTotalDTO[];
  counts: WarrantyCategoryMonthCountDTO[];
}) {
  const router = useRouter();
  const panelTopRef = useRef<HTMLDivElement>(null);
  const [month, setMonth] = useState(currentMonth());
  const [totalValue, setTotalValue] = useState("");
  const [categoryName, setCategoryName] = useState("");
  const [countValue, setCountValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [expanded, setExpanded] = useState(false);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);
  const [confirmingDeleteTotalId, setConfirmingDeleteTotalId] = useState<string | null>(null);

  const saveTotal = async () => {
    const num = Number(totalValue);
    if (!month || totalValue.trim() === "" || Number.isNaN(num) || num < 0) {
      setErr("Pon un mes y un total válido.");
      return;
    }
    setErr("");
    setBusy(true);
    const res = await fetch("/api/warranty-months", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ month, total: num }),
    });
    setBusy(false);
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setErr(data?.error ?? "No se pudo guardar.");
      return;
    }
    setTotalValue("");
    setExpanded(false);
    router.refresh();
  };

  // Single action, same fix as StockoutPanel: identify the category by name
  // (reused case-insensitively if it already exists) and save its count for
  // the month in one click, instead of a separate "Crear" step that could
  // silently lose earlier categories if you created several in a row.
  const saveCount = async () => {
    const name = categoryName.trim();
    const num = Number(countValue);
    if (!month || !name || countValue.trim() === "" || Number.isNaN(num) || num < 0) {
      setErr("Elige un mes, escribe una categoría y un conteo válido.");
      return;
    }
    setErr("");
    setBusy(true);

    const existing = categories.find((c) => c.name.toLowerCase() === name.toLowerCase());
    let categoryId = existing?.id;

    if (!categoryId) {
      const createRes = await fetch("/api/warranty-categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!createRes.ok) {
        setBusy(false);
        const data = await createRes.json().catch(() => null);
        setErr(data?.error ?? "No se pudo crear la categoría.");
        return;
      }
      categoryId = (await createRes.json()).id;
    }

    const res = await fetch("/api/warranty-counts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ month, categoryId, count: num }),
    });
    setBusy(false);
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setErr(data?.error ?? "No se pudo guardar.");
      return;
    }
    setCategoryName("");
    setCountValue("");
    setExpanded(false);
    router.refresh();
  };

  const removeCount = async (id: string) => {
    setBusy(true);
    await fetch(`/api/warranty-counts/${id}`, { method: "DELETE" });
    setBusy(false);
    setConfirmingDeleteId(null);
    router.refresh();
  };

  const removeTotal = async (id: string) => {
    setBusy(true);
    await fetch(`/api/warranty-months/${id}`, { method: "DELETE" });
    setBusy(false);
    setConfirmingDeleteTotalId(null);
    router.refresh();
  };

  // Permanently removes a catalog category (blocked server-side unless it
  // has zero month counts) — different from `removeCount` above, which only
  // removes one month's count.
  const deleteCategory = async (id: string) => {
    setBusy(true);
    const res = await fetch(`/api/warranty-categories/${id}`, { method: "DELETE" });
    setBusy(false);
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setErr(data?.error ?? "No se pudo eliminar.");
      return;
    }
    router.refresh();
  };

  // Editing is just prefilling the forms above with the existing values —
  // resaving upserts on [month, categoryId] / [month], so it replaces the
  // old value instead of requiring a delete-then-recreate.
  const editTotal = (m: string, t: WarrantyMonthTotalDTO) => {
    setMonth(m);
    setTotalValue(String(t.total));
    setErr("");
    panelTopRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const editCount = (m: string, c: WarrantyCategoryMonthCountDTO) => {
    setMonth(m);
    setCategoryName(c.category.name);
    setCountValue(String(c.count));
    setErr("");
    panelTopRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  // Group category counts by month for the compact/expanded history list.
  const countsByMonth = new Map<string, WarrantyCategoryMonthCountDTO[]>();
  for (const c of counts) {
    if (!countsByMonth.has(c.month)) countsByMonth.set(c.month, []);
    countsByMonth.get(c.month)!.push(c);
  }
  const totalsByMonth = new Map(monthTotals.map((t) => [t.month, t]));
  const months = [...new Set([...countsByMonth.keys(), ...totalsByMonth.keys()])].sort().reverse();
  const latestMonth = months[0] ?? null;

  // How many months each catalog category is already anchored to — a
  // category can only be permanently deleted from the Combobox once this
  // hits zero.
  const usageByCategoryId = new Map<string, number>();
  for (const c of counts) usageByCategoryId.set(c.category.id, (usageByCategoryId.get(c.category.id) ?? 0) + 1);
  const comboboxOptions = categories.map((c) => ({ id: c.id, name: c.name, usageCount: usageByCategoryId.get(c.id) ?? 0 }));

  return (
    <div ref={panelTopRef}>
      <div className="bg-surface border border-rule rounded-md p-4.5 mb-3">
        <label className="block mb-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-steel">
          Total de garantías ingresadas ese mes
        </label>
        <div className="flex items-end gap-2.5 flex-wrap">
          <div>
            <label className="block mb-1 text-[10px] text-steel">Mes</label>
            <input
              type="month"
              className="rounded border border-rule px-2.5 py-2 text-[13px] bg-surface"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
            />
          </div>
          <div>
            <label className="block mb-1 text-[10px] text-steel">Total ingresadas</label>
            <input
              type="number"
              min={0}
              className="w-28 rounded border border-rule px-2.5 py-2 text-[13px]"
              placeholder="Ej. 50"
              value={totalValue}
              onChange={(e) => setTotalValue(e.target.value)}
            />
          </div>
          <button
            type="button"
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded border border-blue bg-blue px-3.5 py-2 text-[12.5px] font-semibold text-white cursor-pointer disabled:opacity-60"
            onClick={saveTotal}
          >
            <Plus size={14} /> Guardar total
          </button>
        </div>
        <div className="text-[11px] text-steel mt-2.5">
          Si el mes ya tiene un total, guardar uno nuevo lo reemplaza — así puedes corregir un error.
        </div>
      </div>

      <div className="bg-surface border border-rule rounded-md p-4.5 mb-5">
        <label className="block mb-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-steel">
          Agregar una categoría a ese mes
        </label>
        <div className="flex items-end gap-2.5 flex-wrap">
          <div>
            <label className="block mb-1 text-[10px] text-steel">Categoría</label>
            <Combobox
              className="rounded border border-rule px-2.5 py-2 text-[13px] bg-surface min-w-[200px]"
              placeholder="Escribe o elige una categoría…"
              value={categoryName}
              onChange={setCategoryName}
              options={comboboxOptions}
              onDelete={deleteCategory}
            />
          </div>
          <div>
            <label className="block mb-1 text-[10px] text-steel">Cantidad</label>
            <input
              type="number"
              min={0}
              className="w-24 rounded border border-rule px-2.5 py-2 text-[13px]"
              placeholder="Ej. 12"
              value={countValue}
              onChange={(e) => setCountValue(e.target.value)}
            />
          </div>
          <button
            type="button"
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded border border-blue bg-blue px-3.5 py-2 text-[12.5px] font-semibold text-white cursor-pointer disabled:opacity-60"
            onClick={saveCount}
          >
            <Plus size={14} /> Guardar
          </button>
        </div>
        {err && <div className="text-red text-[12.5px] mt-2.5">{err}</div>}
        <div className="text-[11px] text-steel mt-2.5">
          Si la categoría ya existe, escribe su nombre igual y se reutiliza. Si el mes y la categoría ya tienen un valor, guardar uno nuevo lo reemplaza. En la lista desplegable, el bote de basura elimina una categoría del catálogo para siempre — solo si no tiene historial guardado.
        </div>
      </div>

      {months.length === 0 && (
        <div className="border-[1.5px] border-dashed border-rule rounded-md p-8.5 text-center text-steel text-[13.5px]">
          Aún no hay ningún mes cargado.
        </div>
      )}

      {latestMonth && (
        <div>
          <button
            type="button"
            className="w-full flex items-center justify-between gap-3 bg-surface border border-rule rounded p-3.5 mb-2.5 cursor-pointer"
            onClick={() => setExpanded((v) => !v)}
          >
            {!expanded ? (
              <div className="flex items-center gap-3">
                <span className="font-semibold text-[13.5px]">{formatMonthShort(latestMonth)}</span>
                <span className="text-[12.5px] text-steel">
                  {totalsByMonth.get(latestMonth)?.total ?? "—"} ingresadas · {(countsByMonth.get(latestMonth) ?? []).length} categoría
                  {(countsByMonth.get(latestMonth) ?? []).length === 1 ? "" : "s"} · último mes
                </span>
              </div>
            ) : (
              <span className="text-[13px] font-semibold">{months.length} meses cargados</span>
            )}
            <span className="inline-flex items-center gap-1 text-[12px] font-semibold text-blue shrink-0">
              {expanded ? "Ocultar" : `Desplegar todos los meses (${months.length})`}
              {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </span>
          </button>

          {expanded &&
            months.map((m) => (
              <div key={m} className="bg-surface border border-rule rounded p-3.5 mb-2.5">
                <div className="flex items-center gap-2.5 mb-2">
                  <span className="font-semibold text-[13px]">{formatMonthShort(m)}</span>
                  <span className="text-[12px] text-steel">
                    {totalsByMonth.get(m)?.total ?? "—"} ingresadas
                  </span>
                  {totalsByMonth.get(m) &&
                    (confirmingDeleteTotalId === totalsByMonth.get(m)!.id ? (
                      <span className="flex items-center gap-1 text-[11.5px]">
                        <button
                          type="button"
                          disabled={busy}
                          className="text-red font-semibold cursor-pointer"
                          onClick={() => removeTotal(totalsByMonth.get(m)!.id)}
                        >
                          Sí, eliminar total
                        </button>
                        <button type="button" className="text-steel cursor-pointer" onClick={() => setConfirmingDeleteTotalId(null)}>
                          Cancelar
                        </button>
                      </span>
                    ) : (
                      <span className="flex items-center gap-2">
                        <button
                          type="button"
                          className="text-steel hover:text-blue cursor-pointer"
                          onClick={() => editTotal(m, totalsByMonth.get(m)!)}
                          aria-label="Editar total del mes"
                        >
                          <Pencil size={13} />
                        </button>
                        <button
                          type="button"
                          className="text-steel hover:text-red cursor-pointer"
                          onClick={() => setConfirmingDeleteTotalId(totalsByMonth.get(m)!.id)}
                          aria-label="Eliminar total del mes"
                        >
                          <Trash2 size={13} />
                        </button>
                      </span>
                    ))}
                </div>
                <div className="flex flex-wrap gap-2">
                  {(countsByMonth.get(m) ?? []).map((c) => (
                    <span key={c.id} className="inline-flex items-center gap-1.5 text-[12px] bg-cloud border border-rule rounded-full px-2.5 py-1">
                      {c.category.name} · {c.count}
                      {confirmingDeleteId === c.id ? (
                        <span className="flex items-center gap-1">
                          <button type="button" disabled={busy} className="text-red font-semibold cursor-pointer" onClick={() => removeCount(c.id)}>
                            Sí
                          </button>
                          <button type="button" className="text-steel cursor-pointer" onClick={() => setConfirmingDeleteId(null)}>
                            No
                          </button>
                        </span>
                      ) : (
                        <span className="flex items-center gap-1">
                          <button type="button" className="text-steel hover:text-blue cursor-pointer" onClick={() => editCount(m, c)} aria-label="Editar categoría">
                            <Pencil size={11} />
                          </button>
                          <button type="button" className="text-steel hover:text-red cursor-pointer" onClick={() => setConfirmingDeleteId(c.id)} aria-label="Eliminar categoría">
                            <Trash2 size={11} />
                          </button>
                        </span>
                      )}
                    </span>
                  ))}
                  {(countsByMonth.get(m) ?? []).length === 0 && (
                    <span className="text-[12px] text-steel">Sin categorías cargadas ese mes.</span>
                  )}
                </div>
              </div>
            ))}
        </div>
      )}
    </div>
  );
}
