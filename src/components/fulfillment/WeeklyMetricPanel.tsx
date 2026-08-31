"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, Pencil, Search } from "lucide-react";
import { PushTypeToggle } from "@/components/shared/PushTypeToggle";

export type WeeklyMetricDTO = {
  id: string;
  week: string; // "YYYY-Www"
  value: number;
  notDispatched: number | null;
  prepared: number | null;
  generated: number | null;
  outOfStock: number | null;
};

function formatWeek(week: string) {
  const [year, w] = week.split("-W");
  return `Semana ${Number(w)} · ${year}`;
}

function fillRate(value: number, notDispatched: number | null) {
  if (notDispatched === null) return null;
  const total = value + notDispatched;
  if (total === 0) return null;
  return Math.round((value / total) * 100);
}

// Confirmado 2026-08-31: bandas reemplazan las anteriores (98/95) — ≥96%
// excelente, 90-95% muy bueno, <90% alerta/ineficiente. Debe quedar igual
// que fillRateColor/status en dashboard.ts y FillRateBreakdownCard.
function fillRateColor(pct: number) {
  if (pct >= 96) return "#22C55E";
  if (pct >= 90) return "#D9A441";
  return "#E0574A";
}

const RECENT_WEEKS = 8;

export function WeeklyMetricPanel({
  deptId,
  records,
  editable,
  label,
}: {
  deptId: string;
  records: WeeklyMetricDTO[];
  editable: boolean;
  label: string;
}) {
  const router = useRouter();
  const sorted = [...records].sort((a, b) => (a.week < b.week ? 1 : -1));

  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [week, setWeek] = useState("");
  const [value, setValue] = useState("");
  const [prepared, setPrepared] = useState("");
  const [generated, setGenerated] = useState("");
  const [outOfStock, setOutOfStock] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [search, setSearch] = useState("");

  const query = search.trim().toLowerCase();
  const visible = query
    ? sorted.filter((r) => formatWeek(r.week).toLowerCase().includes(query) || r.week.toLowerCase().includes(query))
    : sorted.slice(0, RECENT_WEEKS);
  const hiddenCount = query ? 0 : Math.max(0, sorted.length - RECENT_WEEKS);

  const startNew = () => {
    setEditingId(null);
    setWeek("");
    setValue("");
    setPrepared("");
    setGenerated("");
    setOutOfStock("");
    setFormOpen(true);
    setErr("");
  };

  const startEdit = (r: WeeklyMetricDTO) => {
    setEditingId(r.id);
    setWeek(r.week);
    setValue(String(r.value));
    setPrepared(r.prepared === null ? "" : String(r.prepared));
    setGenerated(r.generated === null ? "" : String(r.generated));
    setOutOfStock(r.outOfStock === null ? "" : String(r.outOfStock));
    setFormOpen(true);
    setErr("");
  };

  const save = async () => {
    if (!week || value === "") {
      setErr("Completa la semana y el valor.");
      return;
    }
    setErr("");
    setBusy(true);
    const payload = {
      value: Number(value),
      prepared: prepared === "" ? null : Number(prepared),
      generated: generated === "" ? null : Number(generated),
      outOfStock: outOfStock === "" ? null : Number(outOfStock),
    };
    const res = editingId
      ? await fetch(`/api/weekly-metrics/${editingId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        })
      : await fetch("/api/weekly-metrics", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ deptId, week, ...payload }),
        });
    setBusy(false);
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setErr(data?.error ?? "No se pudo guardar el registro.");
      return;
    }
    setFormOpen(false);
    setEditingId(null);
    setWeek("");
    setValue("");
    setPrepared("");
    setGenerated("");
    setOutOfStock("");
    router.refresh();
  };

  const remove = async (id: string) => {
    if (!confirm("¿Eliminar este registro semanal? Esta acción no se puede deshacer.")) return;
    setBusy(true);
    await fetch(`/api/weekly-metrics/${id}`, { method: "DELETE" });
    setBusy(false);
    router.refresh();
  };

  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-4">
        <div className="text-[13px] text-steel">
          Registro semanal de {label.toLowerCase()}. Se muestra en Inicio para todo el equipo.
        </div>
        <PushTypeToggle type="pedidos_despachados" />
        {editable && (
          <button
            type="button"
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded border border-blue bg-blue px-3.5 py-2 text-[12.5px] font-semibold text-white cursor-pointer disabled:opacity-60 shrink-0"
            onClick={startNew}
          >
            <Plus size={14} /> Nuevo registro
          </button>
        )}
      </div>

      {formOpen && (
        <div className="bg-surface border border-rule rounded-md p-4.5 mb-4">
          <div className="mb-3">
            <label className="block mb-1 text-[10.5px] font-semibold uppercase tracking-wide text-steel">Semana</label>
            <input
              type="week"
              disabled={!!editingId}
              className="w-full max-w-[200px] rounded border border-rule px-2.5 py-2 text-[13.5px] disabled:bg-cloud disabled:text-steel"
              value={week}
              onChange={(e) => setWeek(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-3">
            <div>
              <label className="flex items-center gap-1.5 mb-1 text-[10.5px] font-semibold uppercase tracking-wide text-steel">
                <span className="w-2 h-2 rounded-sm bg-teal shrink-0" />
                {label} (despachadas)
              </label>
              <input
                type="number"
                min={0}
                step="1"
                className="w-full rounded border border-rule px-2.5 py-2 text-[13.5px]"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder="ej. 1920"
              />
              <div className="text-[10.5px] text-steel mt-1">Se preparó, se etiquetó y se entregó al courier — el proceso completo.</div>
            </div>
            <div>
              <label className="flex items-center gap-1.5 mb-1 text-[10.5px] font-semibold uppercase tracking-wide text-steel">
                <span className="w-2 h-2 rounded-sm bg-blue shrink-0" />
                Guías preparadas
              </label>
              <input
                type="number"
                min={0}
                step="1"
                className="w-full rounded border border-rule px-2.5 py-2 text-[13.5px]"
                value={prepared}
                onChange={(e) => setPrepared(e.target.value)}
                placeholder="ej. 30"
              />
              <div className="text-[10.5px] text-steel mt-1">Empacada y etiquetada, pero no se entregó al courier (ej. ya se había ido).</div>
            </div>
            <div>
              <label className="flex items-center gap-1.5 mb-1 text-[10.5px] font-semibold uppercase tracking-wide text-steel">
                <span className="w-2 h-2 rounded-sm bg-gold shrink-0" />
                Guías generadas
              </label>
              <input
                type="number"
                min={0}
                step="1"
                className="w-full rounded border border-rule px-2.5 py-2 text-[13.5px]"
                value={generated}
                onChange={(e) => setGenerated(e.target.value)}
                placeholder="ej. 20"
              />
              <div className="text-[10.5px] text-steel mt-1">Ya existe la guía/etiqueta, pero el producto no se empacó — no alcanzó el tiempo.</div>
            </div>
            <div>
              <label className="flex items-center gap-1.5 mb-1 text-[10.5px] font-semibold uppercase tracking-wide text-steel">
                <span className="w-2 h-2 rounded-sm bg-red shrink-0" />
                Por falta de stock
              </label>
              <input
                type="number"
                min={0}
                step="1"
                className="w-full rounded border border-rule px-2.5 py-2 text-[13.5px]"
                value={outOfStock}
                onChange={(e) => setOutOfStock(e.target.value)}
                placeholder="ej. 30"
              />
              <div className="text-[10.5px] text-steel mt-1">No se pudo ni preparar porque no había la mercadería disponible.</div>
            </div>
          </div>
          <div className="text-[11.5px] text-steel mb-3">
            Las 3 de la derecha son opcionales — con ellas calculamos el Fill Rate y el desglose que se ve en Inicio: despachadas ÷ (despachadas + preparadas + generadas + falta de stock).
          </div>
          {err && <div className="text-red text-[12.5px] mb-2.5">{err}</div>}
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              disabled={busy}
              className="rounded border border-blue bg-blue px-4 py-2 text-[13px] font-semibold text-white cursor-pointer disabled:opacity-60"
              onClick={save}
            >
              Guardar
            </button>
            <button
              type="button"
              className="text-steel text-[13px] cursor-pointer"
              onClick={() => {
                setFormOpen(false);
                setEditingId(null);
              }}
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {sorted.length === 0 && !formOpen && (
        <div className="border-[1.5px] border-dashed border-rule rounded-md p-8.5 text-center text-steel text-[13.5px]">
          Aún no hay registros semanales.
        </div>
      )}

      {sorted.length > 0 && (
        <div className="relative mb-3 max-w-xs">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-steel" />
          <input
            type="text"
            className="w-full rounded border border-rule pl-8 pr-2.5 py-2 text-[13px]"
            placeholder="Buscar semana (ej. S25, 2026)…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      )}

      {hiddenCount > 0 && (
        <div className="text-[11.5px] text-steel mb-2">
          Mostrando las últimas {RECENT_WEEKS} semanas · {hiddenCount} más — búscalas arriba.
        </div>
      )}

      {query && visible.length === 0 && (
        <div className="text-steel text-[13px] mb-2">Sin resultados para &ldquo;{search}&rdquo;.</div>
      )}

      {visible.map((r) => {
        const rate = fillRate(r.value, r.notDispatched);
        const hasBreakdown = r.prepared !== null || r.generated !== null || r.outOfStock !== null;
        return (
          <div key={r.id} className="bg-surface border border-rule rounded p-3.5 mb-2">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <span className="font-semibold text-[13.5px]">{formatWeek(r.week)}</span>
              <div className="flex items-center gap-3 flex-wrap">
                <span className="font-mono text-[13.5px]">{r.value.toLocaleString("es-MX")} despachados</span>
                {!hasBreakdown && r.notDispatched !== null && (
                  <span className="font-mono text-[13.5px] text-steel">{r.notDispatched.toLocaleString("es-MX")} pendientes</span>
                )}
                {rate !== null && (
                  <span
                    className="font-mono text-[11px] font-semibold px-2.5 py-1 rounded-full"
                    style={{ color: fillRateColor(rate), border: `1px solid ${fillRateColor(rate)}`, background: `${fillRateColor(rate)}1a` }}
                  >
                    Fill Rate {rate}%
                  </span>
                )}
                {editable && (
                  <div className="flex items-center gap-2">
                    <button type="button" className="text-steel hover:text-ink cursor-pointer" onClick={() => startEdit(r)}>
                      <Pencil size={14} />
                    </button>
                    <button type="button" className="text-steel hover:text-red cursor-pointer" onClick={() => remove(r.id)}>
                      <Trash2 size={14} />
                    </button>
                  </div>
                )}
              </div>
            </div>
            {hasBreakdown && (
              <div className="flex items-center gap-3 flex-wrap mt-2 pt-2 border-t border-dashed border-rule text-[11.5px] text-steel">
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-blue" />Preparadas: {(r.prepared ?? 0).toLocaleString("es-MX")}</span>
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-gold" />Generadas: {(r.generated ?? 0).toLocaleString("es-MX")}</span>
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-red" />Falta de stock: {(r.outOfStock ?? 0).toLocaleString("es-MX")}</span>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
