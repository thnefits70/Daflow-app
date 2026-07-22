"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Upload, FileText, X, AlertTriangle, CheckCircle2, Download } from "lucide-react";
import type { FinanceKpiDataDTO } from "@/lib/financeKpis";

const MONTH_NAMES = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];

function monthLabel(period: string) {
  const [y, m] = period.split("-");
  return `${MONTH_NAMES[Number(m) - 1] ?? m} ${y}`;
}

function currentPeriod() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

// Last 12 months through the next 2 — enough range to correct an old month
// or get a head start on an upcoming one.
function periodOptions(): string[] {
  const now = new Date();
  const opts: string[] = [];
  for (let i = -12; i <= 2; i++) {
    const dt = new Date(now.getFullYear(), now.getMonth() + i, 1);
    opts.push(`${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}`);
  }
  return opts;
}

function money(v: number) {
  return "$" + Math.round(v).toLocaleString("es-MX");
}

type PreviewRow = {
  operationId: string;
  operationName: string;
  ventas: number;
  costoVentas: number;
  gastosVenta: number;
  gastosAdmin: number;
  otrosIngresos: number;
  gastosFinancieros: number;
  otrosGastos: number;
  roi: number | null;
};
type Preview = {
  period: string;
  rows: PreviewRow[];
  shared: { inventarioFinal: number | null; cuentasPorCobrar: number | null; cuentasPorPagar: number | null } | null;
};

const EMPTY_MANUAL = { ventas: "", costoVentas: "", gastosVenta: "", gastosAdmin: "", otrosIngresos: "", gastosFinancieros: "", otrosGastos: "", roi: "" };
const EMPTY_SHARED = { inventarioFinal: "", cuentasPorCobrar: "", cuentasPorPagar: "" };

export function FinanceUploadPanel({ deptId, data }: { deptId: string; data: FinanceKpiDataDTO }) {
  const router = useRouter();
  const activeOps = data.operations.filter((o) => o.isActive);

  const [targetPeriod, setTargetPeriod] = useState(currentPeriod());
  const [phase, setPhase] = useState<"idle" | "processing" | "preview">("idle");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [fileMeta, setFileMeta] = useState<{ url: string | null; name: string | null }>({ url: null, name: null });
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState("");

  const [manualOpen, setManualOpen] = useState(false);
  const [manualOperationId, setManualOperationId] = useState(activeOps[0]?.id ?? "");
  const [manualFields, setManualFields] = useState(EMPTY_MANUAL);
  const [sharedFields, setSharedFields] = useState(EMPTY_SHARED);

  const existingRowsForPeriod = activeOps
    .map((op) => ({ op, row: data.recordsByOperation[op.id]?.find((r) => r.period === targetPeriod) }))
    .filter((x): x is { op: (typeof activeOps)[number]; row: NonNullable<typeof x.row> } => !!x.row);
  const hasExistingData = existingRowsForPeriod.length > 0;

  function resetUploadState() {
    setPhase("idle");
    setPreview(null);
    setWarnings([]);
    setFileMeta({ url: null, name: null });
    setErr("");
  }

  async function handleFile(file: File) {
    setErr("");
    setToast("");
    setPhase("processing");
    const fd = new FormData();
    fd.append("file", file);
    fd.append("deptId", deptId);
    fd.append("period", targetPeriod);
    const res = await fetch("/api/finance-kpis/parse", { method: "POST", body: fd });
    const json = await res.json().catch(() => null);
    if (!res.ok) {
      setErr(json?.error ?? "No se pudo leer el archivo.");
      setPhase("idle");
      return;
    }
    setPreview(json.preview);
    setWarnings(json.warnings ?? []);
    setFileMeta({ url: json.fileUrl ?? null, name: json.fileName ?? null });
    setPhase("preview");
  }

  async function confirmSave() {
    if (!preview) return;
    setBusy(true);
    setErr("");
    const res = await fetch("/api/finance-kpis/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        deptId,
        period: preview.period,
        rows: preview.rows.map((r) => ({
          operationId: r.operationId, ventas: r.ventas, costoVentas: r.costoVentas, gastosVenta: r.gastosVenta,
          gastosAdmin: r.gastosAdmin, otrosIngresos: r.otrosIngresos, gastosFinancieros: r.gastosFinancieros,
          otrosGastos: r.otrosGastos, roi: r.roi,
        })),
        shared: preview.shared,
        fileUrl: fileMeta.url,
        fileName: fileMeta.name,
      }),
    });
    setBusy(false);
    const json = await res.json().catch(() => null);
    if (!res.ok) {
      setErr(json?.error ?? "No se pudo guardar.");
      return;
    }
    resetUploadState();
    setToast(`✅ ${monthLabel(preview.period)} guardado. El dashboard ya se actualizó.`);
    router.refresh();
  }

  async function saveManualOperation() {
    if (!manualOperationId) return;
    setBusy(true);
    setErr("");
    const n = (v: string) => (v === "" ? 0 : Number(v));
    const res = await fetch("/api/finance-kpis/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        deptId,
        period: targetPeriod,
        rows: [{
          operationId: manualOperationId, ventas: n(manualFields.ventas), costoVentas: n(manualFields.costoVentas),
          gastosVenta: n(manualFields.gastosVenta), gastosAdmin: n(manualFields.gastosAdmin),
          otrosIngresos: n(manualFields.otrosIngresos), gastosFinancieros: n(manualFields.gastosFinancieros),
          otrosGastos: n(manualFields.otrosGastos), roi: manualFields.roi === "" ? null : Number(manualFields.roi),
        }],
        shared: null,
      }),
    });
    setBusy(false);
    const json = await res.json().catch(() => null);
    if (!res.ok) { setErr(json?.error ?? "No se pudo guardar."); return; }
    setManualFields(EMPTY_MANUAL);
    setToast(`✅ ${monthLabel(targetPeriod)} guardado para esa operación.`);
    router.refresh();
  }

  async function saveSharedManual() {
    setBusy(true);
    setErr("");
    const n = (v: string) => (v === "" ? null : Number(v));
    const res = await fetch("/api/finance-kpis/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        deptId,
        period: targetPeriod,
        rows: [],
        shared: {
          inventarioFinal: n(sharedFields.inventarioFinal),
          cuentasPorCobrar: n(sharedFields.cuentasPorCobrar),
          cuentasPorPagar: n(sharedFields.cuentasPorPagar),
        },
      }),
    });
    setBusy(false);
    const json = await res.json().catch(() => null);
    if (!res.ok) { setErr(json?.error ?? "No se pudo guardar."); return; }
    setSharedFields(EMPTY_SHARED);
    setToast(`✅ Saldos compartidos de ${monthLabel(targetPeriod)} guardados.`);
    router.refresh();
  }

  return (
    <div>
      <div className="bg-surface border border-rule rounded-md p-4.5 mb-4">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-steel mb-2.5">Elegir el mes de la plantilla</div>
        <div className="flex items-center gap-3 mb-3 flex-wrap">
          <select
            className="rounded border border-rule bg-cloud px-2.5 py-2 text-[13px] font-mono"
            value={targetPeriod}
            onChange={(e) => { setTargetPeriod(e.target.value); resetUploadState(); }}
          >
            {periodOptions().map((p) => (
              <option key={p} value={p}>{monthLabel(p)}{data.recordsByOperation && Object.values(data.recordsByOperation).some((rows) => rows.some((r) => r.period === p)) ? " · ya cargado" : ""}</option>
            ))}
          </select>
        </div>

        {hasExistingData && (
          <div className="bg-gold/10 border border-gold/30 rounded-md p-3 mb-3.5 text-[12.5px]" style={{ color: "#D9A441" }}>
            <div className="flex items-center gap-1.5 font-semibold mb-2">
              <AlertTriangle size={14} /> Ya existe información cargada para {monthLabel(targetPeriod)}.
            </div>
            <div className="text-steel mb-2">Si subes una plantilla nueva o corriges a mano, se <b className="text-ink">reemplaza</b> lo que ya está — útil si detectaste un error de meses atrás.</div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {existingRowsForPeriod.map(({ op, row }) => (
                <div key={op.id} className="bg-cloud rounded p-2">
                  <div className="text-[9px] uppercase text-steel">{op.name}</div>
                  <div className="text-[12px] font-mono font-semibold text-ink">{money(row.ventas)}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="flex justify-end mb-2.5">
          <a
            href={`/api/finance-kpis/template?deptId=${deptId}&period=${targetPeriod}`}
            className="inline-flex items-center gap-1.5 text-[11.5px] font-semibold text-teal hover:underline"
          >
            <Download size={13} /> Descargar plantilla en blanco — {monthLabel(targetPeriod)}
          </a>
        </div>

        {phase === "idle" && (
          <label className="flex flex-col items-center justify-center gap-1.5 border-[1.5px] border-dashed border-rule rounded-md py-7 cursor-pointer hover:border-teal transition-colors">
            <Upload size={22} className="text-steel" />
            <div className="text-[13px] font-semibold">Arrastra tu plantilla aquí o haz clic para elegirla</div>
            <div className="text-[11px] text-steel">Formato .xlsx, misma plantilla de DAFLOW</div>
            <input
              type="file"
              accept=".xlsx"
              className="hidden"
              onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
            />
          </label>
        )}

        {phase === "processing" && (
          <div className="flex items-center justify-center gap-2.5 py-7 text-steel text-[13px]">
            <span className="w-4 h-4 rounded-full border-2 border-rule border-t-teal animate-spin" /> Leyendo plantilla…
          </div>
        )}

        {phase === "preview" && preview && (
          <div>
            <div className="overflow-x-auto mb-3">
              <table className="w-full text-[12px] border-collapse">
                <thead>
                  <tr>
                    <th className="text-left font-mono text-[9.5px] uppercase text-steel pb-1.5">Operación</th>
                    <th className="text-right font-mono text-[9.5px] uppercase text-steel pb-1.5">Ventas</th>
                    <th className="text-right font-mono text-[9.5px] uppercase text-steel pb-1.5">Costo vtas</th>
                    <th className="text-right font-mono text-[9.5px] uppercase text-steel pb-1.5">G. vtas</th>
                    <th className="text-right font-mono text-[9.5px] uppercase text-steel pb-1.5">G. admin</th>
                    <th className="text-right font-mono text-[9.5px] uppercase text-steel pb-1.5">Otros ing.</th>
                    <th className="text-right font-mono text-[9.5px] uppercase text-steel pb-1.5">G. fin.</th>
                    <th className="text-right font-mono text-[9.5px] uppercase text-steel pb-1.5">Otros gastos</th>
                    <th className="text-right font-mono text-[9.5px] uppercase text-steel pb-1.5">ROI</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.map((r) => (
                    <tr key={r.operationId} className="border-t border-rule/50">
                      <td className="py-1.5 font-semibold">{r.operationName}</td>
                      <td className="py-1.5 text-right font-mono">{money(r.ventas)}</td>
                      <td className="py-1.5 text-right font-mono">{money(r.costoVentas)}</td>
                      <td className="py-1.5 text-right font-mono">{money(r.gastosVenta)}</td>
                      <td className="py-1.5 text-right font-mono">{money(r.gastosAdmin)}</td>
                      <td className="py-1.5 text-right font-mono">{money(r.otrosIngresos)}</td>
                      <td className="py-1.5 text-right font-mono">{money(r.gastosFinancieros)}</td>
                      <td className="py-1.5 text-right font-mono">{money(r.otrosGastos)}</td>
                      <td className="py-1.5 text-right font-mono">{r.roi !== null ? `${r.roi}%` : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {warnings.length > 0 && (
              <div className="flex flex-col gap-1 mb-3">
                {warnings.map((w, i) => (
                  <div key={i} className="text-[11.5px] flex items-start gap-1.5" style={{ color: "#D9A441" }}>
                    <AlertTriangle size={13} className="mt-0.5 shrink-0" /> {w}
                  </div>
                ))}
              </div>
            )}
            {warnings.length === 0 && (
              <div className="text-[11.5px] text-teal flex items-center gap-1.5 mb-3">
                <CheckCircle2 size={13} /> Todas las operaciones activas están completas para este mes.
              </div>
            )}
            {err && <div className="text-red text-[12.5px] mb-2.5">{err}</div>}
            <div className="flex items-center gap-2.5">
              <button
                type="button"
                disabled={busy}
                className="rounded border border-teal bg-teal px-4 py-2 text-[13px] font-semibold text-navy cursor-pointer disabled:opacity-60"
                onClick={confirmSave}
              >
                {hasExistingData ? "Reemplazar" : "Confirmar y guardar"} {monthLabel(preview.period)}
              </button>
              <button type="button" className="text-steel text-[13px] cursor-pointer" onClick={resetUploadState}>
                Cancelar
              </button>
            </div>
          </div>
        )}

        {toast && !preview && (
          <div className="mt-3 flex items-center gap-2 text-teal text-[12.5px] bg-teal/10 border border-teal/30 rounded-md px-3 py-2">
            <CheckCircle2 size={14} /> {toast}
          </div>
        )}
        {err && phase !== "preview" && <div className="text-red text-[12.5px] mt-2.5">{err}</div>}

        <button
          type="button"
          className="text-steel text-[11.5px] mt-3.5 cursor-pointer hover:text-ink"
          onClick={() => setManualOpen((v) => !v)}
        >
          ✍️ ¿Prefieres corregir un valor a mano? Ingresar manualmente
        </button>

        {manualOpen && (
          <div className="mt-3 pt-3.5 border-t border-rule">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-steel mb-2">Una operación — {monthLabel(targetPeriod)}</div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 mb-2.5">
              <select
                className="col-span-2 sm:col-span-4 rounded border border-rule bg-cloud px-2.5 py-2 text-[13px]"
                value={manualOperationId}
                onChange={(e) => setManualOperationId(e.target.value)}
              >
                {activeOps.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
              {([
                ["ventas", "Ventas"], ["costoVentas", "Costo de ventas"], ["gastosVenta", "Gastos de ventas"],
                ["gastosAdmin", "Gastos administrativos"], ["otrosIngresos", "Otros ingresos"],
                ["gastosFinancieros", "Gastos financieros"], ["otrosGastos", "Otros gastos"], ["roi", "ROI del mes (%)"],
              ] as const).map(([key, label]) => (
                <div key={key}>
                  <label className="block mb-1 text-[10px] text-steel">{label}</label>
                  <input
                    type="number" step="any"
                    className="w-full rounded border border-rule bg-cloud px-2.5 py-2 text-[13px] font-mono"
                    value={manualFields[key]}
                    onChange={(e) => setManualFields((f) => ({ ...f, [key]: e.target.value }))}
                  />
                </div>
              ))}
            </div>
            <button
              type="button" disabled={busy}
              className="rounded border border-blue bg-blue px-3.5 py-2 text-[12.5px] font-semibold text-white cursor-pointer disabled:opacity-60 mb-4"
              onClick={saveManualOperation}
            >
              Guardar operación
            </button>

            <div className="text-[11px] font-semibold uppercase tracking-wide text-steel mb-2">Saldos compartidos — {monthLabel(targetPeriod)}</div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 mb-2.5">
              {([
                ["inventarioFinal", "Inventario al cierre del mes"], ["cuentasPorCobrar", "Cuentas por cobrar"], ["cuentasPorPagar", "Cuentas por pagar"],
              ] as const).map(([key, label]) => (
                <div key={key}>
                  <label className="block mb-1 text-[10px] text-steel">{label}</label>
                  <input
                    type="number" step="any"
                    className="w-full rounded border border-rule bg-cloud px-2.5 py-2 text-[13px] font-mono"
                    value={sharedFields[key]}
                    onChange={(e) => setSharedFields((f) => ({ ...f, [key]: e.target.value }))}
                  />
                </div>
              ))}
            </div>
            <button
              type="button" disabled={busy}
              className="rounded border border-blue bg-blue px-3.5 py-2 text-[12.5px] font-semibold text-white cursor-pointer disabled:opacity-60"
              onClick={saveSharedManual}
            >
              Guardar saldos compartidos
            </button>
          </div>
        )}
      </div>

      <div className="bg-surface border border-rule rounded-md p-4.5">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-steel mb-2.5">Cargas recientes</div>
        {data.uploads.length === 0 && <div className="text-steel text-[12.5px]">Aún no hay cargas registradas.</div>}
        {data.uploads.map((u, i) => (
          <div key={i} className="flex items-center gap-2.5 py-2 border-b border-rule/50 last:border-none text-[12.5px]">
            <div className="w-6 h-6 rounded-full bg-blue text-white flex items-center justify-center text-[10px] font-bold shrink-0">
              {(u.uploadedByName ?? "A").slice(0, 2).toUpperCase()}
            </div>
            <div>
              <span className="font-semibold">{u.uploadedByName ?? "Admin"}</span> subió{" "}
              <b>{monthLabel(u.period)}</b>
              {u.isCorrection && <span className="text-gold" style={{ color: "#D9A441" }}> (corregido)</span>}
            </div>
            <div className="ml-auto text-steel font-mono text-[11px]">{new Date(u.createdAt).toLocaleString("es-MX")}</div>
          </div>
        ))}
      </div>

      {activeOps.length === 0 && (
        <div className="mt-4 text-[12.5px] text-steel border border-dashed border-rule rounded-md p-4 flex items-center gap-2">
          <FileText size={15} /> No hay operaciones activas configuradas para este departamento — contacta al admin.
        </div>
      )}
    </div>
  );
}
