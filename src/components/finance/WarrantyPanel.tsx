"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, ChevronDown, ChevronUp } from "lucide-react";
import { formatMonthShort } from "@/components/dashboard/WeeklyTrendChart";

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
  const [month, setMonth] = useState(currentMonth());
  const [totalValue, setTotalValue] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [newCategoryName, setNewCategoryName] = useState("");
  const [creatingCategory, setCreatingCategory] = useState(false);
  const [countValue, setCountValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [expanded, setExpanded] = useState(false);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);

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

  const createCategory = async () => {
    if (!newCategoryName.trim()) {
      setErr("Ponle un nombre a la categoría.");
      return;
    }
    setErr("");
    setBusy(true);
    const res = await fetch("/api/warranty-categories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newCategoryName.trim() }),
    });
    setBusy(false);
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setErr(data?.error ?? "No se pudo crear la categoría.");
      return;
    }
    const created = await res.json();
    setNewCategoryName("");
    setCreatingCategory(false);
    setCategoryId(created.id);
    router.refresh();
  };

  const saveCount = async () => {
    const num = Number(countValue);
    if (!month || !categoryId || countValue.trim() === "" || Number.isNaN(num) || num < 0) {
      setErr("Elige un mes, una categoría y un conteo válido.");
      return;
    }
    setErr("");
    setBusy(true);
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

  // Group category counts by month for the compact/expanded history list.
  const countsByMonth = new Map<string, WarrantyCategoryMonthCountDTO[]>();
  for (const c of counts) {
    if (!countsByMonth.has(c.month)) countsByMonth.set(c.month, []);
    countsByMonth.get(c.month)!.push(c);
  }
  const totalsByMonth = new Map(monthTotals.map((t) => [t.month, t]));
  const months = [...new Set([...countsByMonth.keys(), ...totalsByMonth.keys()])].sort().reverse();
  const latestMonth = months[0] ?? null;

  return (
    <div>
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
      </div>

      <div className="bg-surface border border-rule rounded-md p-4.5 mb-5">
        <label className="block mb-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-steel">
          Agregar una categoría a ese mes
        </label>
        <div className="flex items-end gap-2.5 flex-wrap">
          <div>
            <label className="block mb-1 text-[10px] text-steel">Categoría</label>
            {!creatingCategory ? (
              <select
                className="rounded border border-rule px-2.5 py-2 text-[13px] bg-surface min-w-[180px]"
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
              >
                <option value="">Elige una categoría…</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            ) : (
              <div className="flex items-center gap-1.5">
                <input
                  className="rounded border border-rule px-2.5 py-2 text-[13px]"
                  placeholder="Ej. Aprobada, Producto roto…"
                  value={newCategoryName}
                  onChange={(e) => setNewCategoryName(e.target.value)}
                />
                <button type="button" disabled={busy} className="text-[12px] font-semibold text-blue cursor-pointer" onClick={createCategory}>
                  Crear
                </button>
              </div>
            )}
          </div>
          {!creatingCategory && (
            <button
              type="button"
              className="text-[12px] text-blue font-semibold cursor-pointer mb-2"
              onClick={() => setCreatingCategory(true)}
            >
              + Categoría nueva
            </button>
          )}
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
          Si el mes y la categoría ya tienen un valor, guardar uno nuevo lo reemplaza.
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
                        <button type="button" className="text-steel hover:text-red cursor-pointer" onClick={() => setConfirmingDeleteId(c.id)}>
                          <Trash2 size={11} />
                        </button>
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
