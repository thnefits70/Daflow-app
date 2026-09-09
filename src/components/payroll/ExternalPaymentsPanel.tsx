"use client";

import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Trash2 } from "lucide-react";
import { ProofPreview } from "@/components/shared/ProofPreview";
import { usePasteFile } from "@/lib/usePasteFile";
import { uploadFile } from "@/lib/uploadFile";
import { formatDateTime } from "@/lib/formatDateTime";

const MONTHS = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

type Payment = {
  id: string;
  amount: number;
  paidAt: string;
  receiptUrl: string;
  receiptFileName: string;
  invoiceUrl: string | null;
  invoiceFileName: string | null;
  invoiceNumber: string | null;
  updatedAt: string;
};
type RosterEntry = {
  user: { id: string; name: string; position: string | null };
  requiresInvoice: boolean;
  payment: Payment | null;
};

function RegisterForm({ userId, month, requiresInvoice, onSaved }: { userId: string; month: string; requiresInvoice: boolean; onSaved: () => void }) {
  const [amount, setAmount] = useState("");
  const [receiptUrl, setReceiptUrl] = useState<string | null>(null);
  const [receiptName, setReceiptName] = useState<string | null>(null);
  const [invoiceUrl, setInvoiceUrl] = useState<string | null>(null);
  const [invoiceName, setInvoiceName] = useState<string | null>(null);
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [uploadingReceipt, setUploadingReceipt] = useState(false);
  const [uploadingInvoice, setUploadingInvoice] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  async function handleReceipt(file: File) {
    setUploadingReceipt(true);
    setErr("");
    const res = await uploadFile(file, "external-payment-proofs");
    setUploadingReceipt(false);
    if (!res.ok) { setErr(res.error); return; }
    setReceiptUrl(res.url);
    setReceiptName(res.name);
  }
  const { onPaste, onMouseEnter, onMouseLeave } = usePasteFile(handleReceipt);

  async function handleInvoice(file: File) {
    setUploadingInvoice(true);
    setErr("");
    const res = await uploadFile(file, "external-payment-invoices");
    setUploadingInvoice(false);
    if (!res.ok) { setErr(res.error); return; }
    setInvoiceUrl(res.url);
    setInvoiceName(res.name);
  }

  const canSave = Number(amount) > 0 && !!receiptUrl && (!requiresInvoice || !!invoiceUrl);

  async function save() {
    if (!canSave) return;
    setSaving(true);
    setErr("");
    const res = await fetch("/api/external-payments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId,
        month,
        amount: Number(amount),
        receiptUrl,
        receiptFileName: receiptName,
        invoiceUrl: invoiceUrl ?? undefined,
        invoiceFileName: invoiceName ?? undefined,
        invoiceNumber: invoiceNumber.trim() || undefined,
      }),
    });
    setSaving(false);
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setErr(data?.error ?? "No se pudo registrar el pago.");
      return;
    }
    onSaved();
  }

  return (
    <div className="mt-2.5 border-t border-rule pt-2.5">
      <div className="flex items-center gap-3 flex-wrap">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-wide text-steel mb-1">Monto pagado</div>
          <input
            className="rounded border border-rule bg-surface px-2.5 py-1.5 text-[13px] w-28"
            type="number"
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </div>

        <div onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave} onPaste={onPaste}>
          <div className="text-[10px] font-semibold uppercase tracking-wide text-steel mb-1">Comprobante de pago</div>
          {receiptUrl ? (
            <div className="flex items-center gap-2">
              <ProofPreview url={receiptUrl} filename={receiptName ?? undefined} size={40} />
              <button type="button" className="text-[11px] text-steel-dim underline cursor-pointer" onClick={() => { setReceiptUrl(null); setReceiptName(null); }}>Quitar</button>
            </div>
          ) : (
            <label className="flex items-center justify-center text-[11px] text-steel-dim border-[1.5px] border-dashed border-rule rounded-md px-3 py-2 cursor-pointer">
              {uploadingReceipt ? "Subiendo…" : "Pegá con Ctrl+V o hacé clic"}
              <input type="file" accept="image/*,application/pdf" className="hidden" onChange={(e) => e.target.files?.[0] && handleReceipt(e.target.files[0])} />
            </label>
          )}
        </div>

        {requiresInvoice && (
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-wide text-steel mb-1">Factura</div>
            {invoiceUrl ? (
              <div className="flex items-center gap-2">
                <ProofPreview url={invoiceUrl} filename={invoiceName ?? undefined} size={40} />
                <button type="button" className="text-[11px] text-steel-dim underline cursor-pointer" onClick={() => { setInvoiceUrl(null); setInvoiceName(null); }}>Quitar</button>
              </div>
            ) : (
              <label className="flex items-center justify-center text-[11px] text-steel-dim border-[1.5px] border-dashed border-rule rounded-md px-3 py-2 cursor-pointer">
                {uploadingInvoice ? "Subiendo…" : "Hacé clic para subir"}
                <input type="file" accept="image/*,application/pdf" className="hidden" onChange={(e) => e.target.files?.[0] && handleInvoice(e.target.files[0])} />
              </label>
            )}
          </div>
        )}

        {requiresInvoice && (
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-wide text-steel mb-1">N° de factura</div>
            <input
              className="rounded border border-rule bg-surface px-2.5 py-1.5 text-[13px] w-32"
              value={invoiceNumber}
              onChange={(e) => setInvoiceNumber(e.target.value)}
              placeholder="Opcional"
            />
          </div>
        )}

        <button
          type="button"
          disabled={!canSave || saving}
          className="text-[12px] font-bold bg-teal text-white rounded-md px-3.5 py-2 cursor-pointer disabled:opacity-40 self-end"
          onClick={save}
        >
          {saving ? "Guardando…" : "Registrar pago"}
        </button>
      </div>
      {err && <div className="text-red text-[11.5px] mt-1.5">{err}</div>}
    </div>
  );
}

function RosterRow({ entry, month, canEdit, onChanged }: { entry: RosterEntry; month: string; canEdit: boolean; onChanged: () => void }) {
  const { user, requiresInvoice, payment } = entry;
  const [editing, setEditing] = useState(false);

  async function handleDelete() {
    if (!payment) return;
    if (!confirm("¿Eliminar este pago registrado? Esta acción no se puede deshacer.")) return;
    await fetch(`/api/external-payments/${payment.id}`, { method: "DELETE" });
    onChanged();
  }

  return (
    <div className="bg-surface border border-rule rounded p-3.5 mb-2.5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <div className="font-semibold text-[13.5px]">{user.name}</div>
          <div className="text-[11px] text-steel">
            {user.position ?? ""} {requiresInvoice ? "· entrega factura" : "· solo comprobante"}
          </div>
        </div>
        {payment ? (
          <div className="flex items-center gap-2">
            <span className="text-[11.5px] font-semibold text-green">${payment.amount.toFixed(2)} pagado</span>
            <span className="font-mono text-[10.5px] text-steel">{formatDateTime(payment.updatedAt)}</span>
            <ProofPreview url={payment.receiptUrl} filename={payment.receiptFileName} size={36} />
            {payment.invoiceUrl && <ProofPreview url={payment.invoiceUrl} filename={payment.invoiceFileName ?? undefined} size={36} />}
            {canEdit && (
              <button type="button" className="text-steel hover:text-red cursor-pointer" onClick={handleDelete}>
                <Trash2 size={14} />
              </button>
            )}
          </div>
        ) : canEdit ? (
          <button
            type="button"
            className="text-[12px] font-semibold border border-rule rounded px-2.5 py-1.5 cursor-pointer"
            onClick={() => setEditing((v) => !v)}
          >
            {editing ? "Cancelar" : "Registrar pago"}
          </button>
        ) : (
          <span className="text-[11.5px] text-steel-dim italic">Sin registrar aún.</span>
        )}
      </div>
      {canEdit && !payment && editing && (
        <RegisterForm userId={user.id} month={month} requiresInvoice={requiresInvoice} onSaved={() => { setEditing(false); onChanged(); }} />
      )}
    </div>
  );
}

// Confirmado 2026-09-09: pedido explícito del usuario — control mensual de
// quien está fuera del Rol de pago formal (PayrollProfile.externalPaymentMode)
// y se paga por factura y/o comprobante. Mismo dueño de edición que Roles de
// pago (canEditPayrollRoles = Nairoby); admin ve de solo lectura.
export function ExternalPaymentsPanel({ canEdit }: { canEdit: boolean }) {
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const [roster, setRoster] = useState<RosterEntry[] | null>(null);
  const [loading, setLoading] = useState(false);
  const yearOptions = Array.from({ length: 7 }, (_, i) => now.getFullYear() + 1 - i);

  const monthStr = `${year}-${String(month).padStart(2, "0")}`;

  const load = async () => {
    setLoading(true);
    const res = await fetch(`/api/external-payments?month=${monthStr}`);
    setLoading(false);
    if (!res.ok) return;
    const data = await res.json();
    setRoster(data.roster);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [monthStr]);

  const shiftMonth = (delta: number) => {
    let m = month + delta;
    let y = year;
    if (m < 1) { m = 12; y -= 1; }
    if (m > 12) { m = 1; y += 1; }
    setMonth(m);
    setYear(y);
  };

  return (
    <div>
      <div className="text-[11.5px] text-steel mb-3">
        Personas que se pagan por factura o comprobante en vez del Rol de pago formal — comprobante siempre, factura solo si les corresponde. Se activa persona por persona desde Colaboradores.
      </div>
      <div className="flex items-center gap-1.5 mb-4.5">
        <button type="button" className="p-1.5 border border-rule rounded cursor-pointer" onClick={() => shiftMonth(-1)}>
          <ChevronLeft size={14} />
        </button>
        <select className="rounded border border-rule bg-surface px-2.5 py-2 text-[13px]" value={month} onChange={(e) => setMonth(Number(e.target.value))}>
          {MONTHS.map((m, i) => (
            <option key={m} value={i + 1}>{m}</option>
          ))}
        </select>
        <select className="rounded border border-rule bg-surface px-2.5 py-2 text-[13px]" value={year} onChange={(e) => setYear(Number(e.target.value))}>
          {yearOptions.map((y) => (
            <option key={y} value={y}>{y}</option>
          ))}
        </select>
        <button type="button" className="p-1.5 border border-rule rounded cursor-pointer" onClick={() => shiftMonth(1)}>
          <ChevronRight size={14} />
        </button>
      </div>

      {loading && <div className="text-steel text-[13px]">Cargando…</div>}

      {!loading && (roster?.length ?? 0) === 0 && (
        <div className="border-[1.5px] border-dashed border-rule rounded-md p-8.5 text-center text-steel text-[13.5px]">
          Nadie está en modo de pago externo todavía.
        </div>
      )}

      {!loading && roster?.map((entry) => (
        <RosterRow key={entry.user.id} entry={entry} month={monthStr} canEdit={canEdit} onChanged={load} />
      ))}
    </div>
  );
}
