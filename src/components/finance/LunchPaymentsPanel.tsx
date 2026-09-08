"use client";

import { useEffect, useRef, useState } from "react";
import { Upload, CheckCircle2 } from "lucide-react";
import { uploadFile } from "@/lib/uploadFile";
import { compressImage } from "@/lib/compressImage";
import { usePasteFile } from "@/lib/usePasteFile";
import { TabGuide } from "@/components/shared/TabGuide";
import { AdminPayeePicker, type AdminPaymentPayeeDTO } from "@/components/finance/AdminPayeePicker";
import { formatDateTime } from "@/lib/formatDateTime";

type HistoryRow = {
  id: string;
  motivo: string;
  monto: number;
  status: "PENDING_PAYMENT" | "PAID" | "CONFIRMED";
  lunchWeekStart: string | null;
  lunchWeekEnd: string | null;
  lunchCount: number | null;
  createdAt: string;
};

const STATUS_LABELS: Record<HistoryRow["status"], string> = {
  PENDING_PAYMENT: "Pendiente de pago",
  PAID: "Pagado — falta confirmar",
  CONFIRMED: "Confirmado",
};

function money(n: number) {
  return `$${n.toLocaleString("es-MX", { minimumFractionDigits: 2 })}`;
}
function dateEs(iso: string) {
  return new Date(`${iso}T00:00:00`).toLocaleDateString("es-EC", { day: "numeric", month: "long", year: "numeric" });
}

export function LunchPaymentsPanel() {
  const [loaded, setLoaded] = useState(false);
  const [pricePerLunch, setPricePerLunch] = useState(2.5);
  const [payees, setPayees] = useState<AdminPaymentPayeeDTO[]>([]);
  const [history, setHistory] = useState<HistoryRow[]>([]);

  const [weekStart, setWeekStart] = useState("");
  const [weekEnd, setWeekEnd] = useState("");
  const [lunchCount, setLunchCount] = useState("");
  const [montoOverride, setMontoOverride] = useState<string | null>(null);
  const [payee, setPayee] = useState<AdminPaymentPayeeDTO | null>(null);
  const [bankAccountId, setBankAccountId] = useState<string | null>(null);
  const [declarationUrl, setDeclarationUrl] = useState<string | null>(null);
  const [declarationName, setDeclarationName] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { onPaste, onMouseEnter, onMouseLeave } = usePasteFile((file) => uploadDeclaration(file));

  function load() {
    fetch("/api/lunch-payments")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!data) return;
        setPricePerLunch(data.settings.pricePerLunch);
        setPayees(data.payees ?? []);
        setHistory(data.history ?? []);
        if (data.defaults.suggestedWeekStart) setWeekStart(data.defaults.suggestedWeekStart);
        if (data.defaults.payeeId) {
          const p = (data.payees ?? []).find((x: AdminPaymentPayeeDTO) => x.id === data.defaults.payeeId);
          if (p) setPayee(p);
        }
        if (data.defaults.bankAccountId) setBankAccountId(data.defaults.bankAccountId);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }
  useEffect(load, []);

  const computedMonto = Number(lunchCount) > 0 ? (Number(lunchCount) * pricePerLunch).toFixed(2) : "";
  const monto = montoOverride ?? computedMonto;

  async function uploadDeclaration(file: File) {
    setErr("");
    setUploading(true);
    const compressed = await compressImage(file);
    const uploaded = await uploadFile(compressed, "admin-payments");
    setUploading(false);
    if (!uploaded.ok) {
      setErr(uploaded.error);
      return;
    }
    setDeclarationUrl(uploaded.url);
    setDeclarationName(uploaded.name);
  }

  async function submit() {
    setErr("");
    if (!weekStart || !weekEnd) {
      setErr("Elige la semana (fecha inicial y final).");
      return;
    }
    const count = Number(lunchCount);
    if (!count || count <= 0) {
      setErr("Ingresa la cantidad de almuerzos de esta semana.");
      return;
    }
    setSubmitting(true);
    const res = await fetch("/api/lunch-payments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        weekStart,
        weekEnd,
        lunchCount: count,
        monto: monto ? Number(monto) : undefined,
        payeeId: payee?.id ?? undefined,
        bankAccountId: bankAccountId ?? undefined,
        declarationFileUrl: declarationUrl ?? undefined,
        declarationFileName: declarationName ?? undefined,
      }),
    });
    setSubmitting(false);
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      setErr(data?.error ?? "No se pudo registrar.");
      return;
    }
    setWeekStart(data.lunchWeekEnd ? new Date(new Date(data.lunchWeekEnd).getTime() + 86400000).toISOString().slice(0, 10) : "");
    setWeekEnd("");
    setLunchCount("");
    setMontoOverride(null);
    setDeclarationUrl(null);
    setDeclarationName(null);
    load();
  }

  if (!loaded) return null;

  return (
    <div>
      <TabGuide storageKey="almuerzos-semanales">
        Registra acá, cada semana, cuántos almuerzos se pidieron (convenio con el restaurante) — el monto se calcula solo. Después el admin paga y sube el comprobante, igual que cualquier otro pago administrativo.
      </TabGuide>

      <div className="bg-surface border border-rule rounded-md p-4 mb-4">
        <div className="text-[13px] font-bold mb-2.5">Registrar semana de almuerzos</div>
        <div className="text-[11px] text-steel mb-2.5">Precio actual: {money(pricePerLunch)} por almuerzo (IVA incluido)</div>

        <div className="flex gap-2 mb-2.5">
          <div className="flex-1">
            <label className="block mb-1 text-[10px] font-semibold uppercase tracking-wide text-steel">Desde</label>
            <input type="date" value={weekStart} onChange={(e) => setWeekStart(e.target.value)} className="w-full rounded border border-rule px-2.5 py-2 text-[13px]" />
          </div>
          <div className="flex-1">
            <label className="block mb-1 text-[10px] font-semibold uppercase tracking-wide text-steel">Hasta</label>
            <input type="date" value={weekEnd} onChange={(e) => setWeekEnd(e.target.value)} className="w-full rounded border border-rule px-2.5 py-2 text-[13px]" />
          </div>
        </div>

        <label className="block mb-1 text-[10px] font-semibold uppercase tracking-wide text-steel">Cantidad de almuerzos</label>
        <input
          type="number"
          min="1"
          value={lunchCount}
          onChange={(e) => setLunchCount(e.target.value)}
          placeholder="Ej. 45"
          className="w-full rounded border border-rule px-2.5 py-2 text-[13px] mb-2.5"
        />

        <label className="block mb-1 text-[10px] font-semibold uppercase tracking-wide text-steel">
          Monto a pagar <span className="text-steel-dim">(se calcula solo — ajusta si la factura real difiere por centavos)</span>
        </label>
        <input
          type="number"
          step="0.01"
          value={monto}
          onChange={(e) => setMontoOverride(e.target.value)}
          className="w-full rounded border border-rule px-2.5 py-2 text-[13px] mb-2.5"
        />

        <div className="mb-2.5">
          <label className="block mb-1 text-[10px] font-semibold uppercase tracking-wide text-steel">A quién pagar <span className="text-steel-dim">(opcional)</span></label>
          <AdminPayeePicker
            payees={payees}
            value={payee}
            onChange={setPayee}
            isAdmin={false}
            selectedBankAccountId={bankAccountId}
            onSelectBankAccount={setBankAccountId}
            onPayeeUpdated={(p) => setPayees((cur) => (cur.some((x) => x.id === p.id) ? cur.map((x) => (x.id === p.id ? p : x)) : [...cur, p].sort((a, b) => a.name.localeCompare(b.name))))}
          />
        </div>

        {declarationUrl ? (
          <div className="mb-2.5">
            <div className="flex items-center gap-1.5 text-[11.5px] text-teal mb-1.5">
              <CheckCircle2 size={13} /> Factura adjuntada
            </div>
            <button type="button" className="text-steel text-[11px] underline cursor-pointer" onClick={() => { setDeclarationUrl(null); setDeclarationName(null); }}>
              Quitar
            </button>
          </div>
        ) : (
          <div className="mb-2.5">
            <div
              tabIndex={0}
              onPaste={onPaste}
              onMouseEnter={onMouseEnter}
              onMouseLeave={onMouseLeave}
              className="flex items-center gap-1.5 border-[1.5px] border-dashed border-rule rounded px-3 py-2 text-[12px] text-steel cursor-pointer hover:border-teal focus:border-teal focus:outline-none w-fit"
            >
              {uploading ? <span className="w-3.5 h-3.5 rounded-full border-2 border-rule border-t-teal animate-spin" /> : <Upload size={13} />} Foto de la factura (opcional, Ctrl+V)
              <button type="button" className="text-[10.5px] underline decoration-dotted opacity-80 hover:opacity-100 cursor-pointer" onClick={() => fileInputRef.current?.click()}>
                o selecciona un archivo
              </button>
              <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && uploadDeclaration(e.target.files[0])} />
            </div>
          </div>
        )}

        {err && <div className="text-red text-[12px] mb-2.5">{err}</div>}

        <button
          type="button"
          disabled={submitting || uploading}
          className="rounded border border-blue bg-blue px-3.5 py-1.5 text-[12.5px] font-semibold text-white cursor-pointer disabled:opacity-60"
          onClick={submit}
        >
          {submitting ? "Enviando…" : "Registrar semana"}
        </button>
      </div>

      <div className="text-[11px] font-semibold uppercase tracking-wide text-steel mb-2">Semanas ya registradas</div>
      {history.length === 0 ? (
        <div className="text-[12.5px] text-steel">Todavía no has registrado ninguna semana.</div>
      ) : (
        <div className="flex flex-col gap-2">
          {history.map((h) => (
            <div key={h.id} className="bg-surface border border-rule rounded-md px-3 py-2.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[12.5px] font-semibold">
                  {h.lunchWeekStart && h.lunchWeekEnd ? `${dateEs(h.lunchWeekStart.slice(0, 10))} al ${dateEs(h.lunchWeekEnd.slice(0, 10))}` : h.motivo}
                </span>
                <span className="text-[12.5px] font-semibold shrink-0">{money(h.monto)}</span>
              </div>
              <div className="flex items-center justify-between gap-2 mt-1">
                <span className="text-[11px] text-steel">{h.lunchCount} almuerzos · registrado {formatDateTime(h.createdAt)}</span>
                <span className="text-[11px] text-steel shrink-0">{STATUS_LABELS[h.status]}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
