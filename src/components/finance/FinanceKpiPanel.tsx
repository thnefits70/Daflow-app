"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, Pencil, Upload, X, FileText, TrendingUp } from "lucide-react";

export type FinanceKpiDTO = {
  id: string;
  period: string; // "YYYY-MM"
  roi: number | null;
  monthlySales: number | null;
  monthlyProfit: number | null;
  notes: string;
  fileUrl: string | null;
  fileName: string | null;
};

const MONTHS = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];

function formatPeriod(period: string) {
  const [year, month] = period.split("-");
  const idx = Number(month) - 1;
  return `${MONTHS[idx] ?? month} ${year}`;
}

function formatMoney(value: number | null) {
  if (value === null) return "—";
  return `$${value.toLocaleString("es-MX", { maximumFractionDigits: 0 })}`;
}

type Draft = {
  id: string | null;
  period: string;
  roi: string;
  monthlySales: string;
  monthlyProfit: string;
  notes: string;
  fileUrl: string | null;
  fileName: string | null;
};

const EMPTY_DRAFT: Draft = {
  id: null,
  period: "",
  roi: "",
  monthlySales: "",
  monthlyProfit: "",
  notes: "",
  fileUrl: null,
  fileName: null,
};

export function FinanceKpiPanel({
  deptId,
  records,
  editable,
}: {
  deptId: string;
  records: FinanceKpiDTO[];
  editable: boolean;
}) {
  const router = useRouter();
  const sorted = [...records].sort((a, b) => (a.period < b.period ? 1 : -1));
  const chartData = [...records].sort((a, b) => (a.period < b.period ? -1 : 1)).slice(-12);
  const maxSales = Math.max(1, ...chartData.map((r) => r.monthlySales ?? 0));

  const [formOpen, setFormOpen] = useState(false);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const startNew = () => {
    setDraft(EMPTY_DRAFT);
    setFormOpen(true);
    setErr("");
  };

  const startEdit = (r: FinanceKpiDTO) => {
    setDraft({
      id: r.id,
      period: r.period,
      roi: r.roi !== null ? String(r.roi) : "",
      monthlySales: r.monthlySales !== null ? String(r.monthlySales) : "",
      monthlyProfit: r.monthlyProfit !== null ? String(r.monthlyProfit) : "",
      notes: r.notes,
      fileUrl: r.fileUrl,
      fileName: r.fileName,
    });
    setFormOpen(true);
    setErr("");
  };

  const uploadReport = async (file: File) => {
    setErr("");
    setBusy(true);
    const fd = new FormData();
    fd.append("file", file);
    fd.append("folder", "finance-kpis");
    const res = await fetch("/api/upload", { method: "POST", body: fd });
    setBusy(false);
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setErr(data?.error ?? "No se pudo subir el archivo.");
      return;
    }
    const data = await res.json();
    setDraft((d) => ({ ...d, fileUrl: data.url, fileName: data.name }));
  };

  const save = async () => {
    if (!draft.period) {
      setErr("Selecciona el mes del registro.");
      return;
    }
    setErr("");
    setBusy(true);
    const payload = {
      roi: draft.roi === "" ? null : Number(draft.roi),
      monthlySales: draft.monthlySales === "" ? null : Number(draft.monthlySales),
      monthlyProfit: draft.monthlyProfit === "" ? null : Number(draft.monthlyProfit),
      notes: draft.notes,
      fileUrl: draft.fileUrl,
      fileName: draft.fileName,
    };
    const res = draft.id
      ? await fetch(`/api/finance-kpis/${draft.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        })
      : await fetch("/api/finance-kpis", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ deptId, period: draft.period, ...payload }),
        });
    setBusy(false);
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setErr(data?.error ?? "No se pudo guardar el registro.");
      return;
    }
    setFormOpen(false);
    setDraft(EMPTY_DRAFT);
    router.refresh();
  };

  const remove = async (id: string) => {
    setBusy(true);
    await fetch(`/api/finance-kpis/${id}`, { method: "DELETE" });
    setBusy(false);
    router.refresh();
  };

  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-4">
        <div className="text-[13px] text-steel">
          Historial mensual de ROI, ventas y ganancia. Sube el reporte financiero de respaldo si lo tienes.
        </div>
        {editable && (
          <button
            type="button"
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded border border-navy bg-navy px-3.5 py-2 text-[12.5px] font-semibold text-white cursor-pointer disabled:opacity-60 shrink-0"
            onClick={startNew}
          >
            <Plus size={14} /> Nuevo registro
          </button>
        )}
      </div>

      {chartData.length > 0 && (
        <div className="bg-white border border-rule rounded-md p-4.5 mb-4">
          <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-steel mb-3">
            <TrendingUp size={13} /> Ventas mensuales
          </div>
          <div className="flex items-end gap-2.5" style={{ height: 120 }}>
            {chartData.map((r) => {
              const h = Math.max(4, ((r.monthlySales ?? 0) / maxSales) * 100);
              return (
                <div key={r.id} className="flex-1 flex flex-col items-center gap-1.5">
                  <div className="w-full flex items-end justify-center" style={{ height: 100 }}>
                    <div
                      className="w-full max-w-[26px] rounded-t"
                      style={{ height: `${h}%`, background: "#1E5EFF" }}
                      title={formatMoney(r.monthlySales)}
                    />
                  </div>
                  <span className="text-[10px] text-steel font-mono">{formatPeriod(r.period).split(" ")[0]}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {formOpen && (
        <div className="bg-white border border-rule rounded-md p-4.5 mb-4">
          <div className="grid grid-cols-2 gap-3 mb-3">
            <div>
              <label className="block mb-1 text-[10.5px] font-semibold uppercase tracking-wide text-steel">Mes</label>
              <input
                type="month"
                disabled={!!draft.id}
                className="w-full rounded border border-rule px-2.5 py-2 text-[13.5px] disabled:bg-cloud disabled:text-steel"
                value={draft.period}
                onChange={(e) => setDraft({ ...draft, period: e.target.value })}
              />
            </div>
            <div>
              <label className="block mb-1 text-[10.5px] font-semibold uppercase tracking-wide text-steel">ROI (%)</label>
              <input
                type="number"
                step="any"
                className="w-full rounded border border-rule px-2.5 py-2 text-[13.5px]"
                value={draft.roi}
                onChange={(e) => setDraft({ ...draft, roi: e.target.value })}
                placeholder="ej. 18.5"
              />
            </div>
            <div>
              <label className="block mb-1 text-[10.5px] font-semibold uppercase tracking-wide text-steel">Ventas del mes</label>
              <input
                type="number"
                step="any"
                className="w-full rounded border border-rule px-2.5 py-2 text-[13.5px]"
                value={draft.monthlySales}
                onChange={(e) => setDraft({ ...draft, monthlySales: e.target.value })}
                placeholder="ej. 45000"
              />
            </div>
            <div>
              <label className="block mb-1 text-[10.5px] font-semibold uppercase tracking-wide text-steel">Ganancia del mes</label>
              <input
                type="number"
                step="any"
                className="w-full rounded border border-rule px-2.5 py-2 text-[13.5px]"
                value={draft.monthlyProfit}
                onChange={(e) => setDraft({ ...draft, monthlyProfit: e.target.value })}
                placeholder="ej. 12000"
              />
            </div>
          </div>
          <div className="mb-3">
            <label className="block mb-1 text-[10.5px] font-semibold uppercase tracking-wide text-steel">Notas (opcional)</label>
            <textarea
              className="w-full rounded border border-rule px-2.5 py-2 text-[13.5px]"
              rows={2}
              value={draft.notes}
              onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
            />
          </div>
          <div className="mb-3.5">
            <label className="block mb-1 text-[10.5px] font-semibold uppercase tracking-wide text-steel">
              Reporte financiero (opcional)
            </label>
            {draft.fileUrl ? (
              <div className="flex items-center justify-between gap-2 border border-rule rounded px-2.5 py-2">
                <span className="text-[13px] flex items-center gap-1.5">
                  <FileText size={13} /> {draft.fileName}
                </span>
                <button
                  type="button"
                  className="text-steel hover:text-red cursor-pointer"
                  onClick={() => setDraft({ ...draft, fileUrl: null, fileName: null })}
                >
                  <X size={14} />
                </button>
              </div>
            ) : (
              <label className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold border border-rule rounded px-3 py-2 cursor-pointer">
                <Upload size={13} /> {busy ? "Subiendo…" : "Subir archivo"}
                <input
                  type="file"
                  accept="application/pdf,image/*"
                  className="hidden"
                  disabled={busy}
                  onChange={(e) => e.target.files?.[0] && uploadReport(e.target.files[0])}
                />
              </label>
            )}
          </div>
          {err && <div className="text-red text-[12.5px] mb-2.5">{err}</div>}
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              disabled={busy}
              className="rounded border border-navy bg-navy px-4 py-2 text-[13px] font-semibold text-white cursor-pointer disabled:opacity-60"
              onClick={save}
            >
              Guardar
            </button>
            <button
              type="button"
              className="text-steel text-[13px] cursor-pointer"
              onClick={() => {
                setFormOpen(false);
                setDraft(EMPTY_DRAFT);
              }}
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {sorted.length === 0 && !formOpen && (
        <div className="border-[1.5px] border-dashed border-rule rounded-md p-8.5 text-center text-steel text-[13.5px]">
          Aún no hay registros de KPIs.
        </div>
      )}

      {sorted.map((r) => (
        <div key={r.id} className="bg-white border border-rule rounded p-4 mb-2.5 flex items-center justify-between gap-3">
          <div className="flex items-center gap-5 flex-wrap">
            <div className="font-semibold text-[14px] w-20">{formatPeriod(r.period)}</div>
            <div>
              <div className="text-[10px] uppercase tracking-wide text-steel">ROI</div>
              <div className="text-[13.5px] font-semibold">{r.roi !== null ? `${r.roi}%` : "—"}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wide text-steel">Ventas</div>
              <div className="text-[13.5px] font-semibold">{formatMoney(r.monthlySales)}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wide text-steel">Ganancia</div>
              <div className="text-[13.5px] font-semibold">{formatMoney(r.monthlyProfit)}</div>
            </div>
            {r.notes && <div className="text-[12.5px] text-steel max-w-xs">{r.notes}</div>}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {r.fileUrl && (
              <a
                href={r.fileUrl}
                target="_blank"
                rel="noreferrer"
                className="text-[12px] font-semibold border border-rule rounded px-2.5 py-1.5 cursor-pointer"
              >
                Ver reporte
              </a>
            )}
            {editable && (
              <>
                <button type="button" className="text-steel hover:text-navy cursor-pointer" onClick={() => startEdit(r)}>
                  <Pencil size={15} />
                </button>
                <button type="button" className="text-steel hover:text-red cursor-pointer" onClick={() => remove(r.id)}>
                  <Trash2 size={15} />
                </button>
              </>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
