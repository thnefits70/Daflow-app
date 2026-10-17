"use client";

import { useEffect, useRef, useState } from "react";
import { FileText, Upload } from "lucide-react";
import { uploadFile } from "@/lib/uploadFile";
import { formatDateTime } from "@/lib/formatDateTime";
import { usePasteFile } from "@/lib/usePasteFile";

type Row = {
  id: string;
  code: string;
  kind: "RESHIP" | "CASH";
  status: string;
  originalGuide: string;
  clientName: string | null;
  city: string | null;
  reason: string;
  evidenceUrl: string | null;
  orderNumber: string | null;
  freightAmount: number | null;
  paymentMethod: string | null;
  guideNumber: string | null;
  guideAttachedAt: string | null;
  guideAttachedByName: string | null;
  productName: string | null;
  amount: number | null;
  holderName: string | null;
  holderIdNumber: string | null;
  bankName: string | null;
  bankAccountType: string | null;
  bankAccountNumber: string | null;
  payoutProofUrl: string | null;
  paidAt: string | null;
  createdById: string;
  createdByName: string | null;
  createdAt: string;
  reviewedByName: string | null;
  reviewedAt: string | null;
  reviewNote: string | null;
  cancelledAt: string | null;
};
type Role = { userId: string; isAdmin: boolean; canCreate: boolean; canApprove: boolean; canAttachGuide: boolean };

const FOLDER = "warranty-arrangement-files";

const STATUS: Record<string, { label: string; tone: string }> = {
  PAYMENT_REVIEW: { label: "Esperando que el admin verifique el pago", tone: "text-amber" },
  PAYMENT_REJECTED: { label: "Pago no verificado — subir otro comprobante", tone: "text-red" },
  PAYMENT_OK: { label: "Pago verificado — Allan o Daniel generan la guía", tone: "text-blue" },
  DONE: { label: "Guía generada", tone: "text-green" },
  APPROVAL: { label: "Esperando aprobación de Bryan", tone: "text-amber" },
  TO_PAY: { label: "Aprobado — esperando que el admin pague", tone: "text-blue" },
  PAID: { label: "Pagado al dropshipper", tone: "text-green" },
  REJECTED: { label: "No aprobado por Bryan", tone: "text-red" },
  CANCELLED: { label: "Cancelado", tone: "text-steel" },
};
const OPEN = new Set(["PAYMENT_REVIEW", "PAYMENT_REJECTED", "PAYMENT_OK", "APPROVAL", "TO_PAY"]);

const money = (n: number | null) => (n == null ? "—" : `$${n.toFixed(2)}`);
const inputCls = "bg-cloud border border-rule rounded px-2.5 py-1.5 text-[13px]";
const btnPrimary = "rounded border border-teal bg-teal px-3 py-1.5 text-[12px] font-bold text-navy cursor-pointer disabled:opacity-60";
const btnGhost = "rounded border border-rule px-3 py-1.5 text-[12px] font-semibold cursor-pointer disabled:opacity-60";

// Arreglos de garantía (pedido de Bryan 2026-10-15). Ver src/lib/warrantyArrangements.ts.
export function WarrantyArrangementsPanel() {
  const [role, setRole] = useState<Role | null>(null);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [form, setForm] = useState<"RESHIP" | "CASH" | null>(null);

  function load() {
    fetch("/api/warranty-arrangements")
      .then((r) => r.json())
      .then((d) => {
        setRole(d?.role ?? null);
        setRows(Array.isArray(d?.rows) ? d.rows : []);
      })
      .catch(() => setRows([]));
  }
  useEffect(load, []);

  if (rows === null) return <div className="text-[13px] text-steel">Cargando…</div>;
  if (!role) return <div className="text-[13px] text-steel">No tienes acceso a esta pantalla.</div>;

  const open = rows.filter((r) => OPEN.has(r.status));
  const closed = rows.filter((r) => !OPEN.has(r.status));

  return (
    <div className="flex flex-col gap-6 max-w-2xl">
      {role.canCreate && (
        <div className="flex flex-wrap gap-2">
          <button type="button" className={form === "RESHIP" ? btnPrimary : btnGhost} onClick={() => setForm(form === "RESHIP" ? null : "RESHIP")}>
            Reenvío: flete lo paga el dropshipper
          </button>
          <button type="button" className={form === "CASH" ? btnPrimary : btnGhost} onClick={() => setForm(form === "CASH" ? null : "CASH")}>
            Arreglo en dinero con el dropshipper
          </button>
        </div>
      )}
      {form === "RESHIP" && <ReshipForm onDone={() => { setForm(null); load(); }} />}
      {form === "CASH" && <CashForm onDone={() => { setForm(null); load(); }} />}

      <div>
        <div className="font-display font-bold text-[14px] mb-2.5">En curso ({open.length})</div>
        {open.length === 0 ? (
          <div className="text-[13px] text-steel">No hay arreglos en curso.</div>
        ) : (
          <div className="flex flex-col gap-2.5">{open.map((r) => <Card key={r.id} r={r} role={role} onChange={load} />)}</div>
        )}
      </div>
      {closed.length > 0 && (
        <div>
          <div className="font-display font-bold text-[14px] mb-2.5">Terminados (últimos 60 días)</div>
          <div className="flex flex-col gap-2.5">{closed.map((r) => <Card key={r.id} r={r} role={role} onChange={load} />)}</div>
        </div>
      )}
    </div>
  );
}

function FilePick({ label, file, onFile }: { label: string; file: { url: string; name: string } | null; onFile: (f: { url: string; name: string } | null, err?: string) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const paste = usePasteFile((f) => void pick(f));
  async function pick(f: File | null | undefined) {
    if (!f) return;
    setBusy(true);
    const up = await uploadFile(f, FOLDER);
    setBusy(false);
    if (!up.ok) return onFile(null, up.error);
    onFile({ url: up.url, name: f.name });
  }
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[11.5px] font-semibold text-steel">{label}</span>
      <input ref={ref} type="file" accept="application/pdf,image/*" className="hidden" onChange={(e) => pick(e.target.files?.[0])} />
      <div
        tabIndex={0}
        role="button"
        onClick={() => ref.current?.click()}
        onPaste={paste.onPaste}
        onMouseEnter={paste.onMouseEnter}
        onMouseLeave={paste.onMouseLeave}
        onDragOver={paste.onDragOver}
        onDragLeave={paste.onDragLeave}
        onDrop={paste.onDrop}
        className={`flex items-center gap-1.5 self-start border-[1.5px] border-dashed rounded px-3 py-2 text-[12px] cursor-pointer hover:border-teal focus:border-teal focus:outline-none ${paste.isDragOver ? "border-teal bg-teal/10" : "border-rule"}`}
      >
        <Upload size={13} /> {busy ? "Subiendo…" : file ? "Cambiar archivo" : "Elegir, pegar (Ctrl+V) o arrastrar aquí"}
      </div>
      {file && <span className="text-[11.5px] text-green">✓ {file.name}</span>}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11.5px] font-semibold text-steel">{label}</span>
      {children}
    </label>
  );
}

async function post(url: string, body: unknown): Promise<string | null> {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (res.ok) return null;
  const d = await res.json().catch(() => null);
  return d?.error ?? "No se pudo guardar.";
}

function ReshipForm({ onDone }: { onDone: () => void }) {
  const [originalGuide, setOriginalGuide] = useState("");
  const [found, setFound] = useState<Lookup | null>(null);
  const [searching, setSearching] = useState(false);
  const [orderNumber, setOrderNumber] = useState("");
  const [freight, setFreight] = useState("");
  const [method, setMethod] = useState<"DROPI_WALLET" | "TRANSFER" | "">("");
  const [reason, setReason] = useState("");
  const [file, setFile] = useState<{ url: string; name: string } | null>(null);
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);

  async function search() {
    setErr("");
    setFound(null);
    if (originalGuide.trim().length < 3) return setErr("Escribe la guía original del problema.");
    setSearching(true);
    const res = await fetch(`/api/warranty-arrangements?guide=${encodeURIComponent(originalGuide.trim())}`);
    const d = await res.json().catch(() => null);
    setSearching(false);
    if (!res.ok) return setErr(d?.error ?? "No se encontró la guía.");
    setFound(d);
  }

  async function send() {
    setErr("");
    const amount = Number(freight.replace(",", "."));
    if (!found) return setErr("Primero busca la guía original: tiene que haber salido en nuestros cortes.");
    if (orderNumber.trim().length < 2) return setErr("Escribe el número de pedido del reenvío.");
    if (!(amount > 0)) return setErr("Escribe el valor exacto del flete.");
    if (!method) return setErr("Elige cómo pagó el dropshipper.");
    if (reason.trim().length < 5) return setErr("Explica qué hizo mal el dropshipper.");
    if (!file) return setErr("Sube el comprobante del pago.");
    setSaving(true);
    const e = await post("/api/warranty-arrangements", { kind: "RESHIP", originalGuide: found.guide, orderNumber, freightAmount: amount, paymentMethod: method, reason, evidenceUrl: file.url });
    setSaving(false);
    if (e) return setErr(e);
    onDone();
  }

  return (
    <div className="bg-surface border border-rule rounded-md p-4 flex flex-col gap-3">
      <div className="font-display font-bold text-[14px]">Reenvío: flete lo paga el dropshipper</div>
      <div className="text-[12px] text-steel">El dropshipper paga el flete exacto antes. El admin verifica el pago y recién ahí Allan o Daniel generan la guía y la anotan.</div>
      <div className="flex gap-2 items-end">
        <Field label="Guía original del problema">
          <input value={originalGuide} onChange={(e) => { setOriginalGuide(e.target.value); setFound(null); }} placeholder="Ej.: D002055162" className={`${inputCls} font-mono`} />
        </Field>
        <button type="button" disabled={searching} onClick={search} className={btnGhost}>{searching ? "Buscando…" : "Buscar"}</button>
      </div>
      {found && (
        <div className="text-[12.5px] bg-cloud rounded-md p-2.5">
          ✓ Salió en nuestros cortes · <span className="font-semibold">{found.clientName ?? "Cliente sin nombre"}</span>
          {found.city ? ` · ${found.city}` : ""}
          <div className="text-[11.5px] text-steel">{found.lines.map((l) => l.name).join(", ")}</div>
        </div>
      )}
      <Field label="Número de pedido del reenvío">
        <input value={orderNumber} onChange={(e) => setOrderNumber(e.target.value)} className={`${inputCls} font-mono`} />
      </Field>
      <Field label="Valor exacto del flete ($)">
        <input value={freight} onChange={(e) => setFreight(e.target.value)} inputMode="decimal" placeholder="Ej.: 6.50" className={inputCls} />
      </Field>
      <Field label="¿Cómo pagó?">
        <select value={method} onChange={(e) => setMethod(e.target.value as typeof method)} className={inputCls}>
          <option value="">Elegir…</option>
          <option value="DROPI_WALLET">Wallet de Dropi</option>
          <option value="TRANSFER">Transferencia bancaria</option>
        </select>
      </Field>
      <Field label="¿Qué hizo mal el dropshipper?">
        <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} className={inputCls} />
      </Field>
      <FilePick label="Comprobante del pago" file={file} onFile={(f, e) => { setFile(f); if (e) setErr(e); }} />
      {err && <div className="text-red text-[11.5px]">{err}</div>}
      <button type="button" disabled={saving} onClick={send} className={`self-start ${btnPrimary}`}>{saving ? "Enviando…" : "Enviar al admin para verificar"}</button>
    </div>
  );
}

type Lookup = { guide: string; clientName: string | null; city: string | null; lines: { catalogItemId: string; name: string; code: string | null }[] };

function CashForm({ onDone }: { onDone: () => void }) {
  const [guide, setGuide] = useState("");
  const [found, setFound] = useState<Lookup | null>(null);
  const [searching, setSearching] = useState(false);
  const [catalogItemId, setCatalogItemId] = useState("");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [holderName, setHolderName] = useState("");
  const [holderIdNumber, setHolderIdNumber] = useState("");
  const [bankName, setBankName] = useState("");
  const [bankAccountType, setBankAccountType] = useState<"AHORROS" | "CORRIENTE" | "">("");
  const [bankAccountNumber, setBankAccountNumber] = useState("");
  const [file, setFile] = useState<{ url: string; name: string } | null>(null);
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);

  async function search() {
    setErr("");
    setFound(null);
    setCatalogItemId("");
    if (guide.trim().length < 3) return setErr("Escribe la guía del pedido.");
    setSearching(true);
    const res = await fetch(`/api/warranty-arrangements?guide=${encodeURIComponent(guide.trim())}`);
    const d = await res.json().catch(() => null);
    setSearching(false);
    if (!res.ok) return setErr(d?.error ?? "No se encontró la guía.");
    setFound(d);
    if (d.lines?.length === 1) setCatalogItemId(d.lines[0].catalogItemId);
  }

  async function send() {
    setErr("");
    const n = Number(amount.replace(",", "."));
    if (!found) return setErr("Primero busca la guía.");
    if (!catalogItemId) return setErr("Elige el producto del problema.");
    if (!(n > 0)) return setErr("Escribe el monto acordado.");
    if (reason.trim().length < 5) return setErr("Explica el problema y el acuerdo.");
    if (!holderName.trim() || !holderIdNumber.trim() || !bankName.trim() || !bankAccountType || !bankAccountNumber.trim()) return setErr("Completa los datos de la cuenta del dropshipper.");
    if (!file) return setErr("Sube la foto del chat donde el dropshipper acepta.");
    setSaving(true);
    const e = await post("/api/warranty-arrangements", {
      kind: "CASH",
      originalGuide: found.guide,
      catalogItemId,
      amount: n,
      reason,
      holderName,
      holderIdNumber,
      bankName,
      bankAccountType,
      bankAccountNumber,
      evidenceUrl: file.url,
    });
    setSaving(false);
    if (e) return setErr(e);
    onDone();
  }

  return (
    <div className="bg-surface border border-rule rounded-md p-4 flex flex-col gap-3">
      <div className="font-display font-bold text-[14px]">Arreglo en dinero con el dropshipper</div>
      <div className="text-[12px] text-steel">En vez de hacer la garantía, se le devuelve un monto al dropshipper (él es nuestro cliente; con el cliente final no hacemos nada). Bryan aprueba y el admin paga.</div>
      <div className="flex gap-2 items-end">
        <Field label="Guía del pedido">
          <input value={guide} onChange={(e) => setGuide(e.target.value)} placeholder="Ej.: D002055162" className={`${inputCls} font-mono`} />
        </Field>
        <button type="button" disabled={searching} onClick={search} className={btnGhost}>{searching ? "Buscando…" : "Buscar"}</button>
      </div>
      {found && (
        <>
          <div className="text-[12.5px] bg-cloud rounded-md p-2.5">
            <span className="font-semibold">{found.clientName ?? "Cliente sin nombre"}</span>
            {found.city ? ` · ${found.city}` : ""}
          </div>
          <Field label="Producto del problema">
            <select value={catalogItemId} onChange={(e) => setCatalogItemId(e.target.value)} className={inputCls}>
              <option value="">Elegir…</option>
              {found.lines.map((l) => (
                <option key={l.catalogItemId} value={l.catalogItemId}>{l.name}</option>
              ))}
            </select>
          </Field>
          <Field label="Monto acordado ($)">
            <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="Ej.: 4.00" className={inputCls} />
          </Field>
          <Field label="Problema y acuerdo">
            <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} placeholder="Ej.: la faja le quedó pequeña a su cliente; el dropshipper aceptó $4 en vez de la garantía." className={inputCls} />
          </Field>
          <div className="font-semibold text-[12.5px]">Cuenta del dropshipper</div>
          <Field label="Nombre del titular">
            <input value={holderName} onChange={(e) => setHolderName(e.target.value)} className={inputCls} />
          </Field>
          <Field label="Cédula">
            <input value={holderIdNumber} onChange={(e) => setHolderIdNumber(e.target.value)} inputMode="numeric" className={inputCls} />
          </Field>
          <Field label="Banco">
            <input value={bankName} onChange={(e) => setBankName(e.target.value)} className={inputCls} />
          </Field>
          <Field label="Tipo de cuenta">
            <select value={bankAccountType} onChange={(e) => setBankAccountType(e.target.value as typeof bankAccountType)} className={inputCls}>
              <option value="">Elegir…</option>
              <option value="AHORROS">Ahorros</option>
              <option value="CORRIENTE">Corriente</option>
            </select>
          </Field>
          <Field label="Número de cuenta">
            <input value={bankAccountNumber} onChange={(e) => setBankAccountNumber(e.target.value)} inputMode="numeric" className={inputCls} />
          </Field>
          <FilePick label="Foto del chat donde el dropshipper acepta" file={file} onFile={(f, e) => { setFile(f); if (e) setErr(e); }} />
        </>
      )}
      {err && <div className="text-red text-[11.5px]">{err}</div>}
      {found && (
        <button type="button" disabled={saving} onClick={send} className={`self-start ${btnPrimary}`}>{saving ? "Enviando…" : "Enviar a Bryan para aprobar"}</button>
      )}
    </div>
  );
}

function Card({ r, role, onChange }: { r: Row; role: Role; onChange: () => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [text, setText] = useState("");
  const [file, setFile] = useState<{ url: string; name: string } | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [received, setReceived] = useState("");
  const st = STATUS[r.status] ?? { label: r.status, tone: "text-steel" };
  const mine = r.createdById === role.userId;

  async function act(body: Record<string, unknown>, confirmMsg?: string) {
    if (confirmMsg && !window.confirm(confirmMsg)) return;
    setErr("");
    setBusy(true);
    const e = await post(`/api/warranty-arrangements/${r.id}`, body);
    setBusy(false);
    if (e) return setErr(e);
    setText("");
    setFile(null);
    setConfirming(false);
    onChange();
  }

  return (
    <div className="bg-surface border border-rule rounded-md p-3.5 flex flex-col gap-1.5">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="font-mono text-[13px] font-bold text-teal">{r.code}</span>
        <span className="text-[11px] font-semibold rounded bg-cloud px-1.5 py-0.5">{r.kind === "RESHIP" ? "Reenvío · flete del dropshipper" : "Arreglo en dinero"}</span>
        <span className={`text-[11.5px] font-semibold ${st.tone}`}>{st.label}</span>
      </div>
      <div className="text-[12px]">
        Guía original <span className="font-mono">{r.originalGuide}</span>
        {r.clientName ? ` · ${r.clientName}` : ""}
        {r.city ? ` · ${r.city}` : ""}
      </div>
      {r.kind === "RESHIP" ? (
        <div className="text-[12px]">
          Pedido <span className="font-mono">{r.orderNumber}</span> · flete {money(r.freightAmount)} · {r.paymentMethod === "DROPI_WALLET" ? "wallet de Dropi" : "transferencia"}
          {r.guideNumber && (
            <>
              {" "}· guía <span className="font-mono font-semibold">{r.guideNumber}</span>
            </>
          )}
        </div>
      ) : (
        <div className="text-[12px]">
          {r.productName} · <span className="font-semibold">{money(r.amount)}</span> al dropshipper
        </div>
      )}
      <div className="text-[12.5px] whitespace-pre-wrap bg-cloud rounded-md p-2.5">{r.reason}</div>
      {r.kind === "CASH" && (role.isAdmin || role.canApprove || mine) && (
        <div className="text-[12px] border border-rule rounded-md p-2.5">
          <div className="font-semibold mb-0.5">🏦 Pagar a:</div>
          {r.holderName} · CI {r.holderIdNumber}
          <br />
          {r.bankName} · {r.bankAccountType === "CORRIENTE" ? "Corriente" : "Ahorros"} · <span className="font-mono">{r.bankAccountNumber}</span>
        </div>
      )}
      <div className="flex gap-3 flex-wrap">
        {r.evidenceUrl && (
          <a href={r.evidenceUrl} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-[11.5px] font-semibold text-blue">
            <FileText size={12} /> {r.kind === "RESHIP" ? "Comprobante del dropshipper" : "Chat con el dropshipper"}
          </a>
        )}
        {r.payoutProofUrl && (
          <a href={r.payoutProofUrl} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-[11.5px] font-semibold text-blue">
            <FileText size={12} /> Comprobante del pago al dropshipper
          </a>
        )}
      </div>
      <div className="text-[11px] text-steel">
        Registrado por {r.createdByName} · {formatDateTime(r.createdAt)}
        {r.reviewedAt && ` · revisado por ${r.reviewedByName} · ${formatDateTime(r.reviewedAt)}`}
        {r.guideAttachedAt && ` · guía por ${r.guideAttachedByName} · ${formatDateTime(r.guideAttachedAt)}`}
        {r.paidAt && ` · pagado ${formatDateTime(r.paidAt)}`}
      </div>
      {r.reviewNote && <div className="text-[12px] text-red">Motivo: {r.reviewNote}</div>}

      {/* Acciones según quién mira */}
      {r.status === "PAYMENT_REVIEW" && role.isAdmin && (
        <div className="flex flex-col gap-2 mt-1">
          {/* Doble confirmación: primero el botón, luego escribir el monto que llegó. */}
          {!confirming ? (
            <button type="button" disabled={busy} className={`self-start ${btnPrimary}`} onClick={() => { setConfirming(true); setReceived(""); }}>Sí llegó el pago</button>
          ) : (
            <div className="flex flex-col gap-1.5 border border-teal rounded-md p-2.5">
              <span className="text-[12px] font-semibold">Paso 2 de 2: escribe el monto exacto que llegó a tu {r.paymentMethod === "DROPI_WALLET" ? "wallet de Dropi" : "cuenta"}.</span>
              <div className="flex gap-2">
                <input value={received} onChange={(e) => setReceived(e.target.value)} inputMode="decimal" placeholder="Ej.: 6.50" className={`${inputCls} flex-1`} />
                <button
                  type="button"
                  disabled={busy || !(Number(received.replace(",", ".")) > 0)}
                  className={btnPrimary}
                  onClick={() => act({ action: "verify_payment", receivedAmount: Number(received.replace(",", ".")) }, `¿Confirmas que llegaron $${Number(received.replace(",", ".")).toFixed(2)} del dropshipper? Después Allan o Daniel generan la guía.`)}
                >
                  Confirmar ✓
                </button>
                <button type="button" disabled={busy} className={btnGhost} onClick={() => setConfirming(false)}>Volver</button>
              </div>
            </div>
          )}
          <div className="flex gap-2">
            <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Si no llegó, escribe qué pasó" className={`${inputCls} flex-1`} />
            <button type="button" disabled={busy || text.trim().length < 3} className={btnGhost} onClick={() => act({ action: "reject_payment", note: text })}>No llegó</button>
          </div>
        </div>
      )}
      {r.status === "PAYMENT_REJECTED" && mine && (
        <div className="flex flex-col gap-2 mt-1">
          <FilePick label="Nuevo comprobante" file={file} onFile={(f, e) => { setFile(f); if (e) setErr(e); }} />
          <button type="button" disabled={busy || !file} className={`self-start ${btnPrimary}`} onClick={() => file && act({ action: "resubmit_payment", evidenceUrl: file.url })}>Reenviar al admin</button>
        </div>
      )}
      {role.canAttachGuide && r.kind === "RESHIP" && (r.status === "PAYMENT_REVIEW" || r.status === "PAYMENT_REJECTED") && (
        <div className="text-[11.5px] text-amber font-semibold mt-1">🔒 No despachar todavía: el admin no ha verificado el pago.</div>
      )}
      {r.status === "PAYMENT_OK" && role.canAttachGuide && (
        <div className="flex gap-2 mt-1">
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Número de guía generada" className={`${inputCls} font-mono flex-1`} />
          <button type="button" disabled={busy || text.trim().length < 3} className={btnPrimary} onClick={() => act({ action: "attach_guide", guideNumber: text })}>Guardar guía</button>
        </div>
      )}
      {r.status === "APPROVAL" && role.canApprove && (
        <div className="flex flex-col gap-2 mt-1">
          <button type="button" disabled={busy} className={`self-start ${btnPrimary}`} onClick={() => act({ action: "approve" }, `¿Apruebas pagar ${money(r.amount)} al dropshipper?`)}>Aprobar</button>
          <div className="flex gap-2">
            <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Si no lo apruebas, escribe por qué" className={`${inputCls} flex-1`} />
            <button type="button" disabled={busy || text.trim().length < 3} className={btnGhost} onClick={() => act({ action: "reject", note: text })}>No aprobar</button>
          </div>
        </div>
      )}
      {r.status === "TO_PAY" && role.isAdmin && (
        <div className="flex flex-col gap-2 mt-1">
          <FilePick label="Comprobante de la transferencia (cuenta principal)" file={file} onFile={(f, e) => { setFile(f); if (e) setErr(e); }} />
          <button type="button" disabled={busy || !file} className={`self-start ${btnPrimary}`} onClick={() => file && act({ action: "pay", payoutProofUrl: file.url })}>Ya pagué</button>
        </div>
      )}
      {(mine || role.isAdmin) && ["PAYMENT_REVIEW", "PAYMENT_REJECTED", "APPROVAL"].includes(r.status) && (
        <button type="button" disabled={busy} className="self-start text-[11px] text-red cursor-pointer disabled:opacity-60" onClick={() => act({ action: "cancel" }, "¿Cancelar este arreglo?")}>Cancelar</button>
      )}
      {err && <div className="text-red text-[11.5px]">{err}</div>}
    </div>
  );
}
