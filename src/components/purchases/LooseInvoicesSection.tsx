"use client";

import { useEffect, useState } from "react";
import { Upload, FileText, Plus, X } from "lucide-react";
import { uploadFile } from "@/lib/uploadFile";
import { compressImage } from "@/lib/compressImage";
import { usePasteFile } from "@/lib/usePasteFile";
import { formatDateTime } from "@/lib/formatDateTime";

// Confirmado 2026-10-07, pedido de Nairoby: facturas que no corresponden a
// una compra puntual — el proveedor factura con otro nombre un producto ya
// comprado y justificado otro mes (ej. PAWER BANK: factura de octubre,
// compra de septiembre), o facturas generales de CHEN sin producto
// específico que igual sirven de sustento ante el SRI. No cambian el estado
// de factura de ninguna operación.

type Reason = "PREVIOUS_PURCHASE" | "GENERAL_SUPPORT" | "OTHER";

const REASON_LABEL: Record<Reason, string> = {
  PREVIOUS_PURCHASE: "Producto comprado otro mes (ya justificado)",
  GENERAL_SUPPORT: "Factura general / sustento para el SRI",
  OTHER: "Otro",
};

type LooseInvoice = {
  id: string;
  supplier: { id: string; name: string };
  invoiceNumber: string | null;
  invoiceDate: string;
  amount: number;
  docUrl: string;
  reason: Reason;
  relatedGroupId: string | null;
  note: string | null;
  createdAt: string;
  createdBy: { name: string } | null;
  related: { requestNumber: number | null; paidAt: string | null; products: string[] } | null;
};

type Operation = { groupId: string; requestNumber: number | null; paidAt: string | null; total: number; products: string[] };

function money(n: number) {
  return `$${n.toLocaleString("es-MX", { minimumFractionDigits: 2 })}`;
}
function code(n: number | null) {
  return n ? `SC-${String(n).padStart(3, "0")}` : "—";
}
function pad2(n: number) {
  return String(n).padStart(2, "0");
}
function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
// invoiceDate se guarda a mediodía UTC: se lee en UTC para no correr el día.
function invoiceDay(iso: string) {
  const d = new Date(iso);
  return `${pad2(d.getUTCDate())}/${pad2(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
}
function invoiceMonth(iso: string) {
  const d = new Date(iso);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}`;
}
const MONTH_NAMES = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
function monthLabel(month: string) {
  const [y, m] = month.split("-");
  return `${MONTH_NAMES[Number(m) - 1]} ${y}`;
}
function isPdf(url: string) {
  return /\.pdf($|\?)/i.test(url);
}

const LOCK_TITLE = "Exclusivo de Nairoby (líder de Finanzas)";

export function LooseInvoicesSection({ isAdmin = false }: { isAdmin?: boolean }) {
  const [data, setData] = useState<{ invoices: LooseInvoice[]; suppliers: { id: string; name: string }[] } | null>(null);
  const [month, setMonth] = useState("");
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const [supplierId, setSupplierId] = useState("");
  const [invoiceDate, setInvoiceDate] = useState(todayIso());
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [amount, setAmount] = useState("");
  const [docUrl, setDocUrl] = useState("");
  const [reason, setReason] = useState<Reason | "">("");
  const [relatedGroupId, setRelatedGroupId] = useState("");
  const [note, setNote] = useState("");
  const [operations, setOperations] = useState<Operation[] | null>(null);

  function load() {
    fetch("/api/purchase-loose-invoices")
      .then((r) => (r.ok ? r.json() : null))
      .then(setData)
      .catch(() => setData(null));
  }
  useEffect(load, []);

  useEffect(() => {
    if (!supplierId || reason !== "PREVIOUS_PURCHASE") return;
    let cancelled = false;
    fetch(`/api/purchase-loose-invoices?operationsFor=${encodeURIComponent(supplierId)}`)
      .then((r) => (r.ok ? r.json() : []))
      .then((ops) => { if (!cancelled) setOperations(ops); })
      .catch(() => { if (!cancelled) setOperations([]); });
    return () => { cancelled = true; };
  }, [supplierId, reason]);

  async function uploadDoc(file: File) {
    setErr("");
    setUploading(true);
    const uploaded = await uploadFile(await compressImage(file), "purchase-invoices");
    setUploading(false);
    if (!uploaded.ok) {
      setErr(uploaded.error);
      return;
    }
    setDocUrl(uploaded.url);
  }
  const paste = usePasteFile((file) => { if (open) uploadDoc(file); });

  function resetForm() {
    setSupplierId("");
    setInvoiceDate(todayIso());
    setInvoiceNumber("");
    setAmount("");
    setDocUrl("");
    setReason("");
    setRelatedGroupId("");
    setNote("");
    setOperations(null);
    setErr("");
  }

  async function save() {
    setErr("");
    const n = Number(amount.replace(",", "."));
    if (!supplierId) return setErr("Elige el proveedor.");
    if (!docUrl) return setErr("Sube la factura.");
    if (!(n > 0)) return setErr("Pon el monto de la factura.");
    if (!reason) return setErr("Elige por qué se sube esta factura.");
    if (reason === "OTHER" && !note.trim()) return setErr("Escribe una nota explicando la factura.");
    setSaving(true);
    const res = await fetch("/api/purchase-loose-invoices", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        supplierId,
        invoiceDate,
        invoiceNumber: invoiceNumber.trim() || null,
        amount: n,
        docUrl,
        reason,
        relatedGroupId: reason === "PREVIOUS_PURCHASE" ? relatedGroupId || null : null,
        note: note.trim() || null,
      }),
    }).catch(() => null);
    setSaving(false);
    const body = await res?.json().catch(() => null);
    if (!res?.ok) return setErr(body?.error ?? "No se pudo guardar.");
    resetForm();
    setOpen(false);
    load();
  }

  async function remove(id: string) {
    if (confirmDeleteId !== id) {
      setConfirmDeleteId(id);
      return;
    }
    setConfirmDeleteId(null);
    const res = await fetch(`/api/purchase-loose-invoices/${id}`, { method: "DELETE" }).catch(() => null);
    if (!res?.ok) {
      const body = await res?.json().catch(() => null);
      setErr(body?.error ?? "No se pudo quitar.");
      return;
    }
    load();
  }

  if (!data) return null;

  const months = [...new Set(data.invoices.map((i) => invoiceMonth(i.invoiceDate)))];
  const shown = month ? data.invoices.filter((i) => invoiceMonth(i.invoiceDate) === month) : data.invoices;
  const shownTotal = shown.reduce((s, i) => s + i.amount, 0);
  const input = "rounded border border-rule bg-cloud px-2.5 py-1.5 text-[12.5px]";

  return (
    <div className="mt-6">
      <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-steel">Facturas sin compra específica</div>
        {!open && (
          <button
            type="button"
            disabled={isAdmin}
            title={isAdmin ? LOCK_TITLE : undefined}
            className="flex items-center gap-1.5 rounded border border-teal text-teal px-2.5 py-1.5 text-[12px] font-semibold cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            onClick={() => setOpen(true)}
          >
            <Plus size={13} /> Subir factura sin compra específica
          </button>
        )}
      </div>
      <div className="text-[11.5px] text-steel mb-3">
        Para facturas que no son de una compra de este momento: el proveedor puso el nombre de otro producto ya comprado otro mes, o facturas de Chen sin producto específico que sirven de sustento ante el SRI. No cambian ninguna operación.
      </div>

      {open && (
        <div className="bg-surface border border-teal/50 rounded-md p-4 mb-3 flex flex-col gap-3">
          <div className="flex flex-wrap gap-3">
            <label className="flex flex-col gap-1 text-[11px] text-steel">
              Proveedor
              <select className={`${input} min-w-56`} value={supplierId} onChange={(e) => { setSupplierId(e.target.value); setRelatedGroupId(""); setOperations(null); }}>
                <option value="">Elegir…</option>
                {data.suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-[11px] text-steel">
              Fecha de la factura
              <input type="date" className={input} value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} />
            </label>
            <label className="flex flex-col gap-1 text-[11px] text-steel">
              N.º de factura (opcional)
              <input type="text" className={`${input} w-44`} placeholder="001-001-000123" value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} />
            </label>
            <label className="flex flex-col gap-1 text-[11px] text-steel">
              Monto total
              <input type="text" inputMode="decimal" className={`${input} w-32 font-mono`} placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </label>
          </div>

          <div>
            {docUrl ? (
              <div className="flex items-center gap-2 text-[12px]">
                {isPdf(docUrl) ? (
                  <a href={docUrl} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-teal underline"><FileText size={13} /> Ver PDF</a>
                ) : (
                  <a href={docUrl} target="_blank" rel="noreferrer"><img src={docUrl} alt="" className="h-20 rounded border border-rule" /></a>
                )}
                <button type="button" className="text-steel underline cursor-pointer" onClick={() => setDocUrl("")}>Cambiar</button>
              </div>
            ) : (
              <>
                <label
                  tabIndex={0}
                  onPaste={paste.onPaste}
                  onMouseEnter={paste.onMouseEnter}
                  onMouseLeave={paste.onMouseLeave}
                  className="flex items-center gap-1.5 border-[1.5px] border-dashed border-rule rounded px-3 py-2 text-[11.5px] text-steel cursor-pointer hover:border-teal focus:border-teal focus:outline-none w-fit"
                >
                  {uploading ? <span className="w-3.5 h-3.5 rounded-full border-2 border-rule border-t-teal animate-spin" /> : <Upload size={12} />} Subir o pegar la factura
                  <input type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && uploadDoc(e.target.files[0])} />
                </label>
                <label className="flex items-center gap-1 mt-1 text-[10.5px] text-steel cursor-pointer hover:text-teal w-fit">
                  ¿Es un PDF? Subir documento
                  <input type="file" accept="application/pdf" className="hidden" onChange={(e) => e.target.files?.[0] && uploadDoc(e.target.files[0])} />
                </label>
              </>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <div className="text-[11px] text-steel">¿Por qué se sube esta factura?</div>
            <div className="flex flex-wrap gap-2">
              {(Object.keys(REASON_LABEL) as Reason[]).map((r) => (
                <button
                  key={r}
                  type="button"
                  className={`rounded border px-3 py-1.5 text-[12px] cursor-pointer ${reason === r ? "border-teal text-teal bg-teal/10" : "border-rule text-steel"}`}
                  onClick={() => setReason(r)}
                >
                  {REASON_LABEL[r]}
                </button>
              ))}
            </div>
          </div>

          {reason === "PREVIOUS_PURCHASE" && (
            <label className="flex flex-col gap-1 text-[11px] text-steel">
              ¿De qué compra es? (opcional)
              {!supplierId ? (
                <span className="text-steel-dim">Primero elige el proveedor.</span>
              ) : operations === null ? (
                <span className="text-steel-dim">Cargando compras…</span>
              ) : operations.length === 0 ? (
                <span className="text-steel-dim">Este proveedor no tiene compras pagadas.</span>
              ) : (
                <select className={`${input} max-w-full`} value={relatedGroupId} onChange={(e) => setRelatedGroupId(e.target.value)}>
                  <option value="">Sin enlazar</option>
                  {operations.map((o) => (
                    <option key={o.groupId} value={o.groupId}>
                      {code(o.requestNumber)} · {o.paidAt ? invoiceDay(o.paidAt) : "—"} · {o.products.join(", ").slice(0, 80)} · {money(o.total)}
                    </option>
                  ))}
                </select>
              )}
            </label>
          )}

          <label className="flex flex-col gap-1 text-[11px] text-steel">
            Nota {reason === "OTHER" ? "(obligatoria)" : "(opcional)"}
            <textarea rows={2} className={input} placeholder="Ej.: la factura dice PAWER BANK, se compró y justificó en septiembre." value={note} onChange={(e) => setNote(e.target.value)} />
          </label>

          {err && <div className="text-red text-[12px]">{err}</div>}
          <div className="flex gap-2">
            <button type="button" disabled={saving || uploading} className="rounded border border-teal bg-teal text-navy px-3 py-1.5 text-[12.5px] font-semibold cursor-pointer disabled:opacity-50" onClick={save}>
              {saving ? "Guardando…" : "Guardar factura"}
            </button>
            <button type="button" className="rounded border border-rule text-steel px-3 py-1.5 text-[12.5px] cursor-pointer" onClick={() => { resetForm(); setOpen(false); }}>
              Cancelar
            </button>
          </div>
        </div>
      )}

      {data.invoices.length > 0 && (
        <div className="flex items-center gap-2 mb-2 text-[12px] flex-wrap">
          <select className="rounded border border-rule bg-cloud px-2 py-1.5 font-mono" value={month} onChange={(e) => setMonth(e.target.value)}>
            <option value="">Todos los meses</option>
            {months.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
          </select>
          <span className="text-steel">{shown.length} factura{shown.length === 1 ? "" : "s"} · <span className="font-mono text-teal">{money(shownTotal)}</span></span>
        </div>
      )}
      {!open && err && <div className="text-red text-[12px] mb-2">{err}</div>}
      {data.invoices.length === 0 ? (
        <div className="border-[1.5px] border-dashed border-rule rounded-md p-4 text-center text-steel text-[12.5px]">Todavía no hay facturas sin compra específica.</div>
      ) : (
        <div className="flex flex-col gap-2">
          {shown.map((i) => (
            <div key={i.id} className="bg-surface border border-rule rounded-md p-3 flex gap-3 items-start">
              <a href={i.docUrl} target="_blank" rel="noreferrer" className="shrink-0">
                {isPdf(i.docUrl) ? (
                  <div className="w-14 h-14 rounded border border-rule flex items-center justify-center text-teal"><FileText size={20} /></div>
                ) : (
                  <img loading="lazy" decoding="async" src={i.docUrl} alt="" className="w-14 h-14 object-cover rounded border border-rule" />
                )}
              </a>
              <div className="flex-1 min-w-0 text-[12px]">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[13px] font-bold">{i.supplier.name}</span>
                  <span className="font-mono text-teal font-semibold">{money(i.amount)}</span>
                  <span className="text-steel">Factura del {invoiceDay(i.invoiceDate)}</span>
                  {i.invoiceNumber && <span className="font-mono text-steel">N.º {i.invoiceNumber}</span>}
                </div>
                <div className="mt-0.5">
                  <span className="rounded-full border border-gold/40 bg-gold/10 text-gold px-1.5 py-0.5 text-[10.5px] font-semibold">{REASON_LABEL[i.reason]}</span>
                  {i.related && (
                    <span className="ml-1.5 text-steel">
                      Compra {code(i.related.requestNumber)}{i.related.paidAt ? ` (pagada ${invoiceDay(i.related.paidAt)})` : ""} · {i.related.products.join(", ")}
                    </span>
                  )}
                </div>
                {i.note && <div className="text-steel mt-1 whitespace-pre-wrap">{i.note}</div>}
                <div className="text-steel-dim text-[10.5px] mt-1">Subida por {i.createdBy?.name ?? "—"} · {formatDateTime(i.createdAt)}</div>
              </div>
              {!isAdmin && (
                <button
                  type="button"
                  className={`shrink-0 flex items-center gap-1 text-[11px] cursor-pointer ${confirmDeleteId === i.id ? "text-red font-semibold" : "text-steel hover:text-red"}`}
                  onClick={() => remove(i.id)}
                  onBlur={() => setConfirmDeleteId(null)}
                >
                  <X size={12} /> {confirmDeleteId === i.id ? "¿Seguro? Quitar" : "Quitar"}
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
