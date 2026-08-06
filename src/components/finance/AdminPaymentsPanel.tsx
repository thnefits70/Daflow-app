"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Upload, CheckCircle2, Lock, Bell, Trash2 } from "lucide-react";
import { Combobox } from "@/components/ui/Combobox";
import { uploadFile } from "@/lib/uploadFile";
import { compressImage } from "@/lib/compressImage";
import { usePasteFile } from "@/lib/usePasteFile";
import { actorName } from "@/lib/actorName";
import { ProofPreview } from "@/components/shared/ProofPreview";

type PaymentType = "RECURRING" | "VARIABLE";
type Status = "PENDING_PAYMENT" | "PAID" | "CONFIRMED";

type TemplateDTO = { id: string; motivo: string; isActive: boolean };

type RequestDTO = {
  id: string;
  type: PaymentType;
  period: string | null;
  motivo: string;
  monto: number;
  status: Status;
  declarationFileUrl: string | null;
  declarationFileName: string | null;
  declarationAiMatch: boolean | null;
  declarationAiNote: string | null;
  paymentProofUrl: string | null;
  paymentProofName: string | null;
  paymentAiMatch: boolean | null;
  paymentAiNote: string | null;
  paidAt: string | null;
  confirmedAt: string | null;
  createdAt: string;
  template: { id: string; motivo: string } | null;
  createdBy: { name: string } | null;
  paidBy: { name: string } | null;
  confirmedBy: { name: string } | null;
};

function money(n: number) {
  return `$${n.toLocaleString("es-MX", { minimumFractionDigits: 2 })}`;
}
function pad2(n: number) {
  return String(n).padStart(2, "0");
}
function recentMonths(): string[] {
  const now = new Date();
  const months: string[] = [];
  for (let i = 0; i <= 11; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push(`${d.getFullYear()}-${pad2(d.getMonth() + 1)}`);
  }
  return months;
}
function monthBounds(month: string): { from: string; to: string } {
  const [y, m] = month.split("-").map(Number);
  const lastDay = new Date(y, m, 0).getDate();
  return { from: `${month}-01`, to: `${month}-${pad2(lastDay)}` };
}
const MONTH_NAMES = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
function monthFilterLabel(month: string) {
  const [y, m] = month.split("-");
  return `${MONTH_NAMES[Number(m) - 1]} ${y}`;
}

const STATUS_LABELS: Record<Status, string> = {
  PENDING_PAYMENT: "Pendiente de pago",
  PAID: "Pagado — falta confirmar",
  CONFIRMED: "Confirmado",
};

export function AdminPaymentsPanel({ isAdmin }: { isAdmin: boolean }) {
  const router = useRouter();
  const [requests, setRequests] = useState<RequestDTO[] | null>(null);
  const [templates, setTemplates] = useState<TemplateDTO[]>([]);
  const [pendingThisMonth, setPendingThisMonth] = useState<TemplateDTO[]>([]);
  const [err, setErr] = useState("");

  const [showForm, setShowForm] = useState(false);
  const [formType, setFormType] = useState<PaymentType>("VARIABLE");
  const [formMotivo, setFormMotivo] = useState("");
  const [formMonto, setFormMonto] = useState("");
  const [formDeclarationUrl, setFormDeclarationUrl] = useState<string | null>(null);
  const [formDeclarationName, setFormDeclarationName] = useState<string | null>(null);
  const [uploadingDeclaration, setUploadingDeclaration] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const { onPaste: onPasteDeclaration, onMouseEnter: onDeclarationHoverIn, onMouseLeave: onDeclarationHoverOut } = usePasteFile((file) => uploadDeclaration(file));

  const [uploadingProofFor, setUploadingProofFor] = useState<string | null>(null);
  const proofRowIdRef = useRef<string | null>(null);
  const { onPaste: onPasteProof, onMouseEnter: armProofPaste, onMouseLeave: disarmProofPaste } = usePasteFile((file) => {
    const id = proofRowIdRef.current;
    if (id) uploadProofFor(id, file);
  });

  const [remindedId, setRemindedId] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [monthFilter, setMonthFilter] = useState("");

  function load() {
    fetch("/api/admin-payments")
      .then((r) => (r.ok ? r.json() : { requests: [], templates: [], pendingThisMonth: [] }))
      .then((data) => {
        setRequests(data.requests);
        setTemplates(data.templates);
        setPendingThisMonth(data.pendingThisMonth);
      })
      .catch(() => {
        setRequests([]);
        setTemplates([]);
        setPendingThisMonth([]);
      });
  }
  useEffect(load, []);

  function resetForm() {
    setShowForm(false);
    setFormType("VARIABLE");
    setFormMotivo("");
    setFormMonto("");
    setFormDeclarationUrl(null);
    setFormDeclarationName(null);
    setErr("");
  }

  function openFormForTemplate(t: TemplateDTO) {
    setShowForm(true);
    setFormType("RECURRING");
    setFormMotivo(t.motivo);
    setFormMonto("");
    setFormDeclarationUrl(null);
    setFormDeclarationName(null);
    setErr("");
  }

  async function uploadDeclaration(file: File) {
    setErr("");
    setUploadingDeclaration(true);
    const compressed = await compressImage(file);
    const uploaded = await uploadFile(compressed, "admin-payments");
    setUploadingDeclaration(false);
    if (!uploaded.ok) {
      setErr(uploaded.error);
      return;
    }
    setFormDeclarationUrl(uploaded.url);
    setFormDeclarationName(uploaded.name);
  }

  async function createRequest() {
    setErr("");
    if (!formMotivo.trim() || !formMonto || Number(formMonto) <= 0) {
      setErr("Completa el motivo y un monto válido.");
      return;
    }
    setSubmitting(true);
    const body: Record<string, unknown> = {
      type: formType,
      motivo: formMotivo.trim(),
      monto: Number(formMonto),
      declarationFileUrl: formDeclarationUrl ?? undefined,
      declarationFileName: formDeclarationName ?? undefined,
    };
    if (formType === "RECURRING") body.newTemplateMotivo = formMotivo.trim();
    const res = await fetch("/api/admin-payments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    setSubmitting(false);
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      setErr(data?.error ?? "No se pudo crear la solicitud.");
      return;
    }
    resetForm();
    load();
    router.refresh();
  }

  async function uploadProofFor(id: string, file: File) {
    setErr("");
    setUploadingProofFor(id);
    const compressed = await compressImage(file);
    const uploaded = await uploadFile(compressed, "admin-payments");
    if (!uploaded.ok) {
      setUploadingProofFor(null);
      setErr(uploaded.error);
      return;
    }
    const res = await fetch(`/api/admin-payments/${id}/upload-proof`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ proofUrl: uploaded.url, proofName: uploaded.name }),
    });
    setUploadingProofFor(null);
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      setErr(data?.error ?? "No se pudo verificar el comprobante.");
      return;
    }
    load();
    router.refresh();
  }

  async function remindPayment(id: string) {
    setErr("");
    await fetch(`/api/admin-payments/${id}/remind-payment`, { method: "POST" }).catch(() => null);
    setRemindedId(id);
    setTimeout(() => setRemindedId((cur) => (cur === id ? null : cur)), 2500);
  }

  async function confirmDone(id: string) {
    setConfirmingId(id);
    setErr("");
    const res = await fetch(`/api/admin-payments/${id}/confirm`, { method: "POST" });
    setConfirmingId(null);
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      setErr(data?.error ?? "No se pudo confirmar.");
      return;
    }
    load();
    router.refresh();
  }

  async function deleteRequest(id: string) {
    setBusyId(id);
    setErr("");
    const res = await fetch(`/api/admin-payments/${id}`, { method: "DELETE" });
    setBusyId(null);
    setDeleteConfirmId(null);
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      setErr(data?.error ?? "No se pudo borrar.");
      return;
    }
    load();
  }

  function applyMonthFilter(month: string) {
    setMonthFilter(month);
    if (!month) {
      setDateFrom("");
      setDateTo("");
      return;
    }
    const { from, to } = monthBounds(month);
    setDateFrom(from);
    setDateTo(to);
  }
  function applyPrevMonth() {
    const now = new Date();
    const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    applyMonthFilter(`${prev.getFullYear()}-${pad2(prev.getMonth() + 1)}`);
  }
  function clearDateFilter() {
    setMonthFilter("");
    setDateFrom("");
    setDateTo("");
  }

  if (!requests) return <div className="text-steel text-[13px]">Cargando…</div>;

  // Confirmado 2026-08-06: filtra por fecha de pago (paidAt) — las que
  // todavía no se pagaron nunca se ocultan por un filtro pensado para
  // historial, siempre se ven.
  const filtered = (dateFrom || dateTo)
    ? requests.filter((r) => {
        const d = r.paidAt?.slice(0, 10);
        if (!d) return true;
        if (dateFrom && d < dateFrom) return false;
        if (dateTo && d > dateTo) return false;
        return true;
      })
    : requests;

  return (
    <div>
      {pendingThisMonth.length > 0 && (
        <div className="mb-4">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-steel mb-2">Pendientes de registrar este mes</div>
          <div className="flex flex-col gap-2">
            {pendingThisMonth.map((t) => (
              <div key={t.id} className="flex items-center justify-between gap-2 bg-gold/10 border border-gold/35 rounded-md px-3 py-2.5">
                <span className="text-[12.5px] font-semibold" style={{ color: "#D9A441" }}>{t.motivo} — todavía no se registró este mes</span>
                {!isAdmin && (
                  <button type="button" className="rounded border border-gold/50 px-2.5 py-1 text-[11.5px] font-semibold shrink-0 cursor-pointer" style={{ color: "#D9A441" }} onClick={() => openFormForTemplate(t)}>
                    Registrar
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {!isAdmin && (
        <div className="mb-4">
          {showForm ? (
            <div className="bg-surface border border-rule rounded-md p-4">
              <div className="text-[13px] font-bold mb-2.5">Nueva solicitud de pago</div>
              <div className="flex gap-2 mb-2.5">
                <button
                  type="button"
                  className={`flex-1 rounded border py-1.5 text-[12px] font-semibold cursor-pointer ${formType === "VARIABLE" ? "border-teal bg-teal/10 text-teal" : "border-rule text-steel"}`}
                  onClick={() => setFormType("VARIABLE")}
                >
                  Variable
                </button>
                <button
                  type="button"
                  className={`flex-1 rounded border py-1.5 text-[12px] font-semibold cursor-pointer ${formType === "RECURRING" ? "border-teal bg-teal/10 text-teal" : "border-rule text-steel"}`}
                  onClick={() => setFormType("RECURRING")}
                >
                  Recurrente
                </button>
              </div>

              {formType === "RECURRING" ? (
                <Combobox
                  value={formMotivo}
                  onChange={setFormMotivo}
                  options={templates.map((t) => ({ id: t.id, name: t.motivo }))}
                  placeholder="Motivo (ej. Planilla IESS) — escribe o elige uno existente"
                  className="w-full rounded border border-rule px-2.5 py-2 text-[13px] mb-2.5"
                />
              ) : (
                <input
                  value={formMotivo}
                  onChange={(e) => setFormMotivo(e.target.value)}
                  placeholder="Motivo del pago"
                  className="w-full rounded border border-rule px-2.5 py-2 text-[13px] mb-2.5"
                />
              )}

              <input
                type="number"
                step="0.01"
                value={formMonto}
                onChange={(e) => setFormMonto(e.target.value)}
                placeholder="Monto a pagar"
                className="w-full rounded border border-rule px-2.5 py-2 text-[13px] mb-2.5"
              />

              {formDeclarationUrl ? (
                <div className="mb-2.5">
                  <div className="flex items-center gap-1.5 text-[11.5px] text-teal mb-1.5">
                    <CheckCircle2 size={13} /> Documento de soporte subido
                  </div>
                  <button type="button" className="text-steel text-[11px] underline cursor-pointer" onClick={() => { setFormDeclarationUrl(null); setFormDeclarationName(null); }}>
                    Quitar
                  </button>
                </div>
              ) : (
                <label
                  tabIndex={0}
                  onPaste={onPasteDeclaration}
                  onMouseEnter={onDeclarationHoverIn}
                  onMouseLeave={onDeclarationHoverOut}
                  className="flex items-center gap-1.5 border-[1.5px] border-dashed border-rule rounded px-3 py-2 text-[12px] text-steel cursor-pointer hover:border-teal focus:border-teal focus:outline-none w-fit mb-2.5"
                >
                  {uploadingDeclaration ? <span className="w-3.5 h-3.5 rounded-full border-2 border-rule border-t-teal animate-spin" /> : <Upload size={13} />} Subir o pegar documento de soporte (opcional)
                  <input type="file" accept="image/*,application/pdf" className="hidden" onChange={(e) => e.target.files?.[0] && uploadDeclaration(e.target.files[0])} />
                </label>
              )}

              {err && <div className="text-red text-[12px] mb-2.5">{err}</div>}

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={submitting || uploadingDeclaration}
                  className="rounded border border-blue bg-blue px-3.5 py-1.5 text-[12.5px] font-semibold text-white cursor-pointer disabled:opacity-60"
                  onClick={createRequest}
                >
                  {submitting ? "Enviando…" : "Enviar solicitud"}
                </button>
                <button type="button" className="text-steel text-[12.5px] cursor-pointer" onClick={resetForm}>Cancelar</button>
              </div>
            </div>
          ) : (
            <button type="button" className="rounded border border-blue bg-blue px-3.5 py-1.5 text-[12.5px] font-semibold text-white cursor-pointer" onClick={() => setShowForm(true)}>
              + Nueva solicitud de pago
            </button>
          )}
        </div>
      )}

      <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-steel">Solicitudes de pago</div>
        <span className="font-mono text-[10px] text-steel">{filtered.length} de {requests.length}</span>
      </div>
      <div className="flex items-center gap-2 mb-3 flex-wrap text-[12px]">
        <select className="rounded border border-rule bg-cloud px-2 py-1.5 font-mono" value={monthFilter} onChange={(e) => applyMonthFilter(e.target.value)}>
          <option value="">Todos los meses</option>
          {recentMonths().map((m) => (
            <option key={m} value={m}>{monthFilterLabel(m)}</option>
          ))}
        </select>
        <button type="button" className="rounded border border-rule px-2.5 py-1.5 text-steel cursor-pointer hover:border-teal" onClick={applyPrevMonth}>
          Mes anterior
        </button>
        <label className="flex items-center gap-1.5 text-steel">
          Desde
          <input type="date" className="rounded border border-rule bg-cloud px-2 py-1.5" value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); setMonthFilter(""); }} />
        </label>
        <label className="flex items-center gap-1.5 text-steel">
          Hasta
          <input type="date" className="rounded border border-rule bg-cloud px-2 py-1.5" value={dateTo} onChange={(e) => { setDateTo(e.target.value); setMonthFilter(""); }} />
        </label>
        {(dateFrom || dateTo) && (
          <button type="button" className="text-steel underline cursor-pointer" onClick={clearDateFilter}>Limpiar</button>
        )}
      </div>

      {filtered.length === 0 && (
        <div className="border-[1.5px] border-dashed border-rule rounded-md p-6 text-center text-steel text-[13px]">
          {requests.length === 0 ? "Nada por aquí todavía." : "Nada en ese rango de fechas."}
        </div>
      )}

      <div className="flex flex-col gap-2.5">
        {filtered.map((r) => {
          const canDelete = !r.declarationFileUrl && !r.paymentProofUrl;
          return (
            <div key={r.id} className="bg-surface border border-rule rounded-md p-4">
              <div className="flex items-start justify-between gap-2 mb-1">
                <div className="text-[13.5px] font-bold">{r.motivo}</div>
                <span className="text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded bg-cloud text-steel shrink-0">
                  {r.type === "RECURRING" ? "Recurrente" : "Variable"}
                </span>
              </div>
              <div className="text-[11.5px] text-steel">{money(r.monto)} {r.period ? `· período ${r.period}` : ""}</div>
              <div className="text-[10px] text-steel-dim mb-2.5">Solicitada por {actorName(r.createdBy?.name)} · {new Date(r.createdAt).toLocaleDateString("es-MX")}</div>

              {r.declarationFileUrl && (
                <div className="bg-green/10 border border-green/30 rounded-md p-2.5 mb-2.5">
                  <div className="flex items-center gap-2.5 mb-1">
                    <CheckCircle2 size={13} className="text-green shrink-0" />
                    <ProofPreview url={r.declarationFileUrl} size={40} filename="documento-de-soporte" />
                  </div>
                  <div className="text-[11px] text-green">✅ Todo en orden — el documento coincide con lo declarado. {r.declarationAiNote}</div>
                </div>
              )}

              <div className="flex items-center gap-1.5 text-[12px] mb-2.5">
                {r.status === "CONFIRMED" ? <CheckCircle2 size={13} className="text-teal" /> : r.status === "PAID" ? <CheckCircle2 size={13} className="text-blue" /> : <span className="w-1.5 h-1.5 rounded-full bg-gold" />}
                <span className={r.status === "CONFIRMED" ? "text-teal" : r.status === "PAID" ? "text-blue" : "text-steel"}>{STATUS_LABELS[r.status]}</span>
              </div>

              {r.paymentProofUrl && (
                <div className={`border rounded-md p-2.5 mb-2.5 ${r.paymentAiMatch ? "bg-green/10 border-green/30" : "bg-red/10 border-red/30"}`}>
                  <div className="flex items-center gap-2.5 mb-1">
                    {r.paymentAiMatch ? <CheckCircle2 size={13} className="text-green shrink-0" /> : <Lock size={13} className="text-red shrink-0" />}
                    <ProofPreview url={r.paymentProofUrl} size={44} filename="comprobante-de-pago" />
                  </div>
                  <div className={`text-[11px] ${r.paymentAiMatch ? "text-green" : "text-red"}`}>
                    {r.paymentAiMatch ? "✅ Todo en orden — el comprobante coincide con el monto pagado. " : ""}{r.paymentAiNote}
                  </div>
                  {r.paidBy?.name && <div className="text-[10px] text-steel-dim mt-0.5">Pagado por {actorName(r.paidBy.name)}{r.paidAt ? ` · ${new Date(r.paidAt).toLocaleDateString("es-MX")}` : ""}</div>}
                </div>
              )}

              {r.status === "CONFIRMED" && (
                <div className="bg-green/10 border border-green/30 rounded-md px-2.5 py-2 text-[11px] text-green">
                  ✅ Operación finalizada — todo el proceso cuadró correctamente. Confirmado por {actorName(r.confirmedBy?.name)}{r.confirmedAt ? ` · ${new Date(r.confirmedAt).toLocaleDateString("es-MX")}` : ""}
                </div>
              )}

              {r.status === "PENDING_PAYMENT" && isAdmin && (
                <div>
                  {uploadingProofFor === r.id ? (
                    <div className="flex items-center gap-2 text-[12px] text-steel mb-2">
                      <span className="w-3.5 h-3.5 rounded-full border-2 border-rule border-t-teal animate-spin" /> Verificando con IA…
                    </div>
                  ) : (
                    <label
                      tabIndex={0}
                      onPaste={onPasteProof}
                      onMouseEnter={() => { proofRowIdRef.current = r.id; armProofPaste(); }}
                      onMouseLeave={() => { proofRowIdRef.current = null; disarmProofPaste(); }}
                      className="flex items-center gap-1.5 border-[1.5px] border-dashed border-rule rounded px-3 py-2 text-[12px] text-steel cursor-pointer hover:border-teal focus:border-teal focus:outline-none w-fit"
                    >
                      <Upload size={13} /> Subir o pegar comprobante de pago
                      <input type="file" accept="image/*,application/pdf" className="hidden" onChange={(e) => e.target.files?.[0] && uploadProofFor(r.id, e.target.files[0])} />
                    </label>
                  )}
                </div>
              )}

              {r.status === "PENDING_PAYMENT" && !isAdmin && (
                <div className="flex items-center gap-2 flex-wrap">
                  <button
                    type="button"
                    className="rounded border border-rule px-2.5 py-1.5 text-[11.5px] font-semibold text-steel cursor-pointer flex items-center gap-1.5"
                    onClick={() => remindPayment(r.id)}
                  >
                    <Bell size={12} /> {remindedId === r.id ? "✓ Enviado" : "Recordar pago"}
                  </button>
                  {canDelete && (
                    deleteConfirmId === r.id ? (
                      <span className="flex items-center gap-1.5 text-[11.5px]">
                        ¿Borrar?
                        <button type="button" disabled={busyId === r.id} className="text-red font-semibold cursor-pointer" onClick={() => deleteRequest(r.id)}>Sí</button>
                        <button type="button" className="text-steel cursor-pointer" onClick={() => setDeleteConfirmId(null)}>No</button>
                      </span>
                    ) : (
                      <button type="button" className="text-steel text-[11.5px] cursor-pointer flex items-center gap-1" onClick={() => setDeleteConfirmId(r.id)}>
                        <Trash2 size={12} /> Borrar
                      </button>
                    )
                  )}
                </div>
              )}

              {r.status === "PAID" && !isAdmin && (
                <button
                  type="button"
                  disabled={confirmingId === r.id}
                  className="rounded border border-blue bg-blue px-3.5 py-1.5 text-[12.5px] font-semibold text-white cursor-pointer disabled:opacity-60"
                  onClick={() => confirmDone(r.id)}
                >
                  Confirmar completado
                </button>
              )}
            </div>
          );
        })}
      </div>
      {err && <div className="text-red text-[12px] mt-3">{err}</div>}
    </div>
  );
}
