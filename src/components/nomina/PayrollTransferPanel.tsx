"use client";

import { useEffect, useState } from "react";
import { Landmark, ChevronDown, Send } from "lucide-react";
import { ProofPreview } from "@/components/shared/ProofPreview";
import { usePasteFile } from "@/lib/usePasteFile";
import { uploadFile } from "@/lib/uploadFile";

type BankAccount = {
  bankName: string;
  bankAccountType: string;
  bankAccountNumber: string;
  bankAccountHolder: string;
  holderIdType: "RUC" | "CEDULA" | null;
  holderIdNumber: string | null;
};

export type Destination = "NAIROBY" | "ADMIN_PRODUBANCO" | "ADMIN_COMPANY";

export type Transfer = {
  status: "PENDING_APPROVAL" | "APPROVED" | "REJECTED" | "COMPLETED";
  totalAmount: number;
  destination: Destination;
  rejectionReason: string | null;
  proofUrl: string | null;
  proofName: string | null;
  completedAt: string | null;
  account: BankAccount | null;
  confirmedWithoutProof: boolean;
  confirmedWithoutProofNote: string | null;
  confirmedWithoutProofAt: string | null;
  confirmedWithoutProofByName: string | null;
};

function fmtDateTime(iso: string) {
  return new Date(iso).toLocaleString("es-EC", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function money(n: number) {
  return `$${n.toFixed(2)}`;
}

const STATUS_LABEL: Record<Transfer["status"], string> = {
  PENDING_APPROVAL: "Pendiente de aprobación",
  APPROVED: "Aprobado — falta transferir",
  REJECTED: "Rechazado",
  COMPLETED: "Completado",
};

const DESTINATION_LABEL: Record<Destination, string> = {
  NAIROBY: "Cuenta de Nairoby",
  ADMIN_PRODUBANCO: "Cuenta Produbanco de nómina",
  ADMIN_COMPANY: "Cuenta para recibir transferencias",
};

export type IessBreakdownRow = {
  employeeId: string;
  employeeName: string;
  iessDeclaredSalary: number;
  employeePortion: number;
  employerPortion: number;
  partTimePremium: number;
  spouseExtensionPremium: number;
  companyAbsorbsIess: boolean;
  iessPartTime: boolean;
  iessSpouseExtension: boolean;
};

// Confirmado 2026-08-27: pedido explícito del usuario — quería ver cuánto
// de lo que se paga al IESS lo asume Provedix vs. cuánto asume cada
// colaboradora, con nombre y apellido en los casos donde Provedix cubre el
// 100% (hoy Marcos y Dexi — ver companyAbsorbsIess), más la prima de
// salud/maternidad (4.41%) de quienes están a tiempo parcial y la
// extensión de cónyuge (3.41%, hoy solo Dexi) — corregido el mismo día: no
// es una tarifa fija del gobierno, aplica solo a "mitad de sueldo"
// (iessPartTime), nunca a los de 30 días. Colapsado por default para no
// saturar la tarjeta chica del resumen.
function IessBreakdownBlock({ rows }: { rows: IessBreakdownRow[] }) {
  const [show, setShow] = useState(false);
  const absorbedRows = rows.filter((r) => r.companyAbsorbsIess);
  const regularRows = rows.filter((r) => !r.companyAbsorbsIess);
  const partTimeRows = rows.filter((r) => r.iessPartTime);
  const spouseExtensionRows = rows.filter((r) => r.iessSpouseExtension);
  const employerTotal = rows.reduce((s, r) => s + r.employerPortion, 0);
  const regularEmployeeTotal = regularRows.reduce((s, r) => s + r.employeePortion, 0);
  const partTimeTotal = partTimeRows.reduce((s, r) => s + r.partTimePremium, 0);
  const spouseExtensionTotal = spouseExtensionRows.reduce((s, r) => s + r.spouseExtensionPremium, 0);

  return (
    <div className="mb-2.5">
      <button
        type="button"
        className="flex items-center gap-1.5 text-[11px] font-semibold rounded px-2 py-1 cursor-pointer border text-steel border-rule"
        onClick={() => setShow((s) => !s)}
      >
        <Landmark size={12} />
        Desglose de IESS
        <ChevronDown size={12} className={show ? "rotate-180" : ""} />
      </button>
      {show && (
        <div className="mt-1.5 p-2.5 rounded bg-cloud border border-rule text-[12px] flex flex-col gap-1.5">
          <div className="flex justify-between">
            <span className="text-steel">Aporte patronal (11.15%) — todo el equipo</span>
            <span className="font-semibold tabular-nums">{money(employerTotal)}</span>
          </div>
          {regularRows.length > 0 && (
            <div className="flex justify-between">
              <span className="text-steel">Aporte personal (9.45%) — ya descontado a cada colaborador</span>
              <span className="font-semibold tabular-nums">{money(regularEmployeeTotal)}</span>
            </div>
          )}
          {absorbedRows.map((r) => (
            <div key={r.employeeId} className="flex justify-between">
              <span className="text-steel">{r.employeeName} — Provedix asume su aporte personal 100%</span>
              <span className="font-semibold tabular-nums">{money(r.employeePortion)}</span>
            </div>
          ))}
          {partTimeTotal > 0 && (
            <div className="flex justify-between pt-1.5 border-t border-rule">
              <span className="text-steel">Prima salud/maternidad 4.41% — tiempo parcial ({partTimeRows.map((r) => r.employeeName).join(", ")})</span>
              <span className="font-semibold tabular-nums">{money(partTimeTotal)}</span>
            </div>
          )}
          {spouseExtensionTotal > 0 && (
            <div className="flex justify-between pt-1.5 border-t border-rule">
              <span className="text-steel">Extensión de cónyuge 3.41% — {spouseExtensionRows.map((r) => r.employeeName).join(", ")}</span>
              <span className="font-semibold tabular-nums">{money(spouseExtensionTotal)}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function BankAccountBlock({ account }: { account: BankAccount | null }) {
  // Confirmado 2026-08-24: pedido explícito del usuario — la cuenta destino
  // tiene que verse de una, sin un clic extra, porque es el dato que más
  // importa para no transferir mal. Antes arrancaba oculta como la cuenta
  // bancaria de cada colaborador en RoleCard, pero acá el propósito del
  // panel entero es justamente hacer la transferencia.
  const [show, setShow] = useState(true);
  return (
    <div className="mb-2.5">
      <button
        type="button"
        className={`flex items-center gap-1.5 text-[11px] font-semibold rounded px-2 py-1 cursor-pointer border ${account ? "text-steel border-rule" : "text-gold border-gold/40"}`}
        style={account ? undefined : { color: "#D9A441" }}
        onClick={() => setShow((s) => !s)}
      >
        <Landmark size={12} />
        {account ? "Cuenta destino" : "Cuenta destino sin registrar todavía"}
        <ChevronDown size={12} className={show ? "rotate-180" : ""} />
      </button>
      {show && (
        <div className="mt-1.5 p-2.5 rounded bg-cloud border border-rule text-[12px] flex flex-col gap-1">
          {account ? (
            <>
              <div className="flex justify-between"><span className="text-steel">Banco</span><span className="font-semibold">{account.bankName}</span></div>
              <div className="flex justify-between"><span className="text-steel">Tipo de cuenta</span><span className="font-semibold">{account.bankAccountType}</span></div>
              <div className="flex justify-between"><span className="text-steel">N° de cuenta</span><span className="font-semibold tabular-nums">{account.bankAccountNumber}</span></div>
              <div className="flex justify-between"><span className="text-steel">Titular</span><span className="font-semibold">{account.bankAccountHolder}</span></div>
              {account.holderIdNumber && (
                <div className="flex justify-between"><span className="text-steel">{account.holderIdType === "RUC" ? "RUC" : "Cédula"}</span><span className="font-semibold tabular-nums">{account.holderIdNumber}</span></div>
              )}
            </>
          ) : (
            <div className="italic text-steel-dim">Todavía no está registrada — avisale al admin.</div>
          )}
        </div>
      )}
    </div>
  );
}

type VerifyResult = { readAmount: number | null; matches: boolean; note: string };

function ProofUploader({ apiBase, onSent }: { apiBase: string; onSent: () => void }) {
  const [proofUrl, setProofUrl] = useState<string | null>(null);
  const [proofName, setProofName] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [verify, setVerify] = useState<VerifyResult | null>(null);

  async function handleFile(file: File) {
    setUploading(true);
    setErr("");
    setVerify(null);
    const res = await uploadFile(file, "payroll-transfer-proofs");
    setUploading(false);
    if (!res.ok) { setErr(res.error); return; }
    setProofUrl(res.url);
    setProofName(res.name);

    setVerifying(true);
    const verifyRes = await fetch(`${apiBase}/verify-proof`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ proofUrl: res.url }),
    });
    setVerifying(false);
    const verifyData = await verifyRes.json().catch(() => null);
    if (verifyRes.ok && verifyData) setVerify(verifyData);
  }
  const { onPaste, onMouseEnter, onMouseLeave } = usePasteFile(handleFile);
  const blockedByMismatch = !!verify && !verify.matches;

  async function submit() {
    if (!proofUrl || blockedByMismatch) return;
    setSubmitting(true);
    setErr("");
    const res = await fetch(`${apiBase}/proof`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ proofUrl, proofName }),
    });
    setSubmitting(false);
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setErr(data?.error ?? "No se pudo enviar el comprobante — intentá de nuevo.");
      return;
    }
    onSent();
  }

  return (
    <div onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave} onPaste={onPaste} className="mt-2.5 pt-2.5 border-t border-rule">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-steel mb-1.5">Comprobante de la transferencia — Ctrl+V para pegar</div>
      {proofUrl ? (
        <div className="flex items-center gap-2">
          <ProofPreview url={proofUrl} filename={proofName ?? undefined} />
          <button type="button" className="text-[11px] text-steel-dim underline cursor-pointer" onClick={() => { setProofUrl(null); setProofName(null); setVerify(null); }}>Quitar</button>
        </div>
      ) : (
        <div>
          <label className="flex items-center justify-center gap-1.5 text-[11.5px] text-steel-dim border-[1.5px] border-dashed border-rule rounded-md px-3 py-4 cursor-pointer text-center">
            {uploading ? "Subiendo…" : "Pegá con Ctrl+V, o hacé clic para elegir un archivo"}
            {/* accept="image/*" solo (no combinado con PDF) para que el celular
                abra directo la galería de fotos en vez del selector genérico. */}
            <input type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])} />
          </label>
          <label className="flex items-center gap-1 mt-1 text-[10.5px] text-steel-dim cursor-pointer hover:text-teal w-fit mx-auto justify-center">
            ¿Es un PDF? Subir documento
            <input type="file" accept="application/pdf" className="hidden" onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])} />
          </label>
        </div>
      )}
      {err && <div className="text-red text-[11.5px] mt-1.5">{err}</div>}
      {verifying && <div className="text-[11.5px] text-steel-dim mt-1.5">Verificando el comprobante con IA…</div>}
      {verify && (
        <div
          className={`text-[11.5px] rounded px-2.5 py-1.5 mt-1.5 border ${
            verify.readAmount === null
              ? "text-steel bg-cloud border-rule"
              : verify.matches
              ? "text-green bg-green/10 border-green/30"
              : "text-red bg-red/10 border-red/30"
          }`}
        >
          {verify.matches ? "✓ " : verify.readAmount === null ? "" : "⚠ "}{verify.note}
        </div>
      )}
      <button type="button" disabled={!proofUrl || submitting || blockedByMismatch} className="text-[12px] font-bold bg-teal text-white rounded-md px-3.5 py-1.5 cursor-pointer disabled:opacity-40 mt-2.5" onClick={submit}>
        {submitting ? "Enviando…" : "Confirmar transferencia hecha"}
      </button>
      {blockedByMismatch && (
        <div className="text-[11px] text-steel-dim mt-1">Quitá el comprobante y subí uno que sí coincida para poder confirmar.</div>
      )}
    </div>
  );
}

// Confirmado 2026-08-24: pedido explícito del usuario — la cuenta destino
// dejó de ser 100% automática por quincena. Nairoby elige entre las 3
// cuentas ya existentes en la app (nunca inventa una nueva acá): su propia
// cuenta, la Produbanco de nómina, y la de la empresa para recibir
// transferencias (la misma que usan las compras personales). El default
// preseleccionado sigue el criterio de siempre (fin de mes -> Produbanco,
// si no -> Nairoby) pero es editable — así puede esquivar una cuenta que
// se quedó sin fondos sin tener que avisarle al admin por otro lado.
function DestinationPicker({ destination, onChange }: { destination: Destination; onChange: (d: Destination) => void }) {
  const [nairobyAccount, setNairobyAccount] = useState<BankAccount | null | undefined>(undefined);
  const [produbanco, setProdubanco] = useState<BankAccount | null | undefined>(undefined);
  const [company, setCompany] = useState<BankAccount | null | undefined>(undefined);

  useEffect(() => {
    fetch("/api/employee-bank-account")
      .then((r) => (r.ok ? r.json() : []))
      .then((accs: (BankAccount & { isSelected: boolean })[]) => setNairobyAccount(accs.find((a) => a.isSelected) ?? accs[0] ?? null));
    fetch("/api/admin-payroll-bank-account").then((r) => (r.ok ? r.json() : null)).then(setProdubanco);
    fetch("/api/company-bank-account").then((r) => (r.ok ? r.json() : null)).then(setCompany);
  }, []);

  const options: { value: Destination; account: BankAccount | null | undefined }[] = [
    { value: "ADMIN_PRODUBANCO", account: produbanco },
    { value: "ADMIN_COMPANY", account: company },
    { value: "NAIROBY", account: nairobyAccount },
  ];

  return (
    <div className="mb-2.5">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-steel mb-1.5">¿A qué cuenta transferís?</div>
      <div className="flex flex-col gap-1.5">
        {options.map((opt) => {
          const loaded = opt.account !== undefined;
          const configured = !!opt.account?.bankAccountNumber;
          const disabled = loaded && !configured;
          return (
            <label
              key={opt.value}
              className={`flex items-center gap-2 text-[12px] rounded border px-2.5 py-1.5 ${
                disabled ? "opacity-50 cursor-not-allowed border-rule" : "cursor-pointer"
              } ${destination === opt.value && !disabled ? "border-teal bg-teal/10" : "border-rule"}`}
            >
              <input
                type="radio"
                name="payroll-destination"
                disabled={disabled}
                checked={destination === opt.value}
                onChange={() => onChange(opt.value)}
              />
              <span className="flex-1">
                <span className="font-semibold">{DESTINATION_LABEL[opt.value]}</span>
                {loaded && configured && (
                  <span className="text-steel-dim"> — {opt.account!.bankName} ····{opt.account!.bankAccountNumber.slice(-4)}</span>
                )}
                {loaded && !configured && <span className="text-gold"> — sin registrar</span>}
              </span>
            </label>
          );
        })}
      </div>
    </div>
  );
}

function ResendButton({ apiBase, defaultDestination, onSent }: { apiBase: string; defaultDestination: Destination; onSent: () => void }) {
  const [destination, setDestination] = useState<Destination>(defaultDestination);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function send() {
    setBusy(true);
    setErr("");
    const res = await fetch(`${apiBase}/confirm`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ destination }),
    });
    setBusy(false);
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setErr(data?.error ?? "No se pudo enviar.");
      return;
    }
    onSent();
  }

  return (
    <div className="mt-2">
      <DestinationPicker destination={destination} onChange={setDestination} />
      {err && <div className="text-red text-[12px] mb-1.5">{err}</div>}
      <button type="button" disabled={busy} className="text-[12px] font-bold bg-teal text-white rounded-md px-3.5 py-1.5 cursor-pointer disabled:opacity-50" onClick={send}>
        {busy ? "Enviando…" : "Enviar total para transferir"}
      </button>
    </div>
  );
}

function SendTotalPrompt({
  apiBase,
  defaultDestination,
  title,
  description,
  breakdown,
  onSent,
}: {
  apiBase: string;
  defaultDestination: Destination;
  title: string;
  description: string;
  breakdown?: IessBreakdownRow[];
  onSent: () => void;
}) {
  return (
    <div className="bg-surface border border-rule rounded-md p-3.5 mb-4">
      <div className="font-bold text-[13.5px] mb-1">{title}</div>
      <div className="text-[12px] text-steel mb-2.5">{description}</div>
      {breakdown && <IessBreakdownBlock rows={breakdown} />}
      <ResendButton apiBase={apiBase} defaultDestination={defaultDestination} onSent={onSent} />
    </div>
  );
}

// Pedido explícito del usuario 2026-08-27: cuando la cuenta destino es
// propia (ADMIN_COMPANY / ADMIN_PRODUBANCO), pedir un comprobante de una
// transferencia que se hizo a sí mismo es fricción sin sentido. Esta es la
// alternativa al ProofUploader — doble clic (revela un paso de confirmación
// antes de ejecutar, igual que los toggles de permisos en la ficha de
// empleado) más un comentario opcional, para no perder del todo el rastro
// de auditoría que sí da el comprobante.
function ConfirmWithoutProofButton({ apiBase, onSent }: { apiBase: string; onSent: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function submit() {
    setBusy(true);
    setErr("");
    const res = await fetch(`${apiBase}/confirm-without-proof`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ note: note.trim() || undefined }),
    });
    setBusy(false);
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setErr(data?.error ?? "No se pudo confirmar — intentá de nuevo.");
      return;
    }
    onSent();
  }

  if (!confirming) {
    return (
      <button
        type="button"
        className="text-[11.5px] font-semibold text-steel hover:text-ink underline underline-offset-2 cursor-pointer mt-1.5"
        onClick={() => setConfirming(true)}
      >
        Ya está en mi cuenta — confirmar sin comprobante
      </button>
    );
  }

  return (
    <div className="mt-2 p-2.5 rounded bg-cloud border border-rule">
      <div className="text-[11.5px] mb-2">¿Seguro que ya transferiste? Esto marca la transferencia como completada sin foto de respaldo, con tu nombre y la hora exacta como constancia.</div>
      <input
        className="w-full rounded border border-rule px-2.5 py-1.5 text-[12px] mb-2"
        placeholder="Comentario opcional (ej. ya estaba en mi cuenta)"
        maxLength={500}
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />
      {err && <div className="text-red text-[11.5px] mb-2">{err}</div>}
      <div className="flex gap-2">
        <button type="button" disabled={busy} className="rounded border border-teal bg-teal px-3 py-1.5 text-[11.5px] font-bold text-navy cursor-pointer disabled:opacity-60" onClick={submit}>
          {busy ? "Confirmando…" : "Sí, confirmar transferencia"}
        </button>
        <button
          type="button"
          disabled={busy}
          className="text-[11.5px] text-steel cursor-pointer"
          onClick={() => {
            setConfirming(false);
            setNote("");
            setErr("");
          }}
        >
          Cancelar
        </button>
      </div>
    </div>
  );
}

// Confirmado 2026-08-24: pedido explícito del usuario — el orden real es
// primero pagar, después publicar/entregar el rol a cada colaborador.
// Nairoby envía el total (suma de "Líquido a pagar" de todos los roles)
// mientras el período sigue en borrador — la cuenta destino es automática
// según el período (ver isEndOfMonthQuincena en payrollCalc.ts). El admin
// tiene 3 pasos separados: Aprobar, Rechazar (con motivo) y, aparte, subir
// el comprobante ya transferido — recién con el comprobante subido se
// habilita "Publicar" en PayrollRolesPanel. Nairoby ve todo esto en modo
// solo lectura (necesita ver también la cuenta Produbanco del admin en la
// 2da quincena, porque es ella quien entra ahí a pagar).
function TransferPanel({
  apiBase,
  title,
  description,
  defaultDestination,
  isAdmin,
  canEdit,
  transfer,
  onChanged,
  breakdown,
}: {
  apiBase: string;
  title: string;
  description: string;
  defaultDestination: Destination;
  isAdmin: boolean;
  canEdit: boolean;
  transfer: Transfer | null | undefined;
  onChanged: () => void;
  breakdown?: IessBreakdownRow[];
}) {
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function approve() {
    setBusy(true);
    setErr("");
    const res = await fetch(`${apiBase}/approve`, { method: "POST" });
    setBusy(false);
    if (!res.ok) { setErr("No se pudo aprobar."); return; }
    onChanged();
  }

  async function reject() {
    if (!reason.trim()) return;
    setBusy(true);
    setErr("");
    const res = await fetch(`${apiBase}/reject`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: reason.trim() }),
    });
    setBusy(false);
    if (!res.ok) { setErr("No se pudo rechazar."); return; }
    setRejecting(false);
    setReason("");
    onChanged();
  }

  async function undoCompletion() {
    if (!window.confirm("¿Seguro que esta confirmación fue un error? Esto vuelve la transferencia a \"Aprobado — falta transferir\" y borra el comprobante o la confirmación sin comprobante actual.")) return;
    setBusy(true);
    setErr("");
    const res = await fetch(`${apiBase}/undo-completion`, { method: "POST" });
    setBusy(false);
    if (!res.ok) { setErr("No se pudo deshacer la confirmación."); return; }
    onChanged();
  }

  if (transfer === undefined) return null;
  if (transfer === null) {
    if (canEdit) return <SendTotalPrompt apiBase={apiBase} defaultDestination={defaultDestination} title={title} description={description} breakdown={breakdown} onSent={onChanged} />;
    return null;
  }

  const destinationLabel = DESTINATION_LABEL[transfer.destination];

  return (
    <div className="bg-surface border border-rule rounded-md p-3.5 mb-4">
      <div className="flex items-center justify-between gap-2 mb-2.5">
        <div>
          <div className="font-bold text-[13.5px]">{title}</div>
          <div className="text-[10.5px] text-steel">{destinationLabel}</div>
        </div>
        <div className="flex flex-col items-end gap-0.5 bg-teal/15 border-2 border-teal/50 rounded-md px-3 py-1.5">
          <div className="text-[24px] font-extrabold tabular-nums text-teal leading-none">{money(transfer.totalAmount)}</div>
          <div className="text-[9.5px] text-teal/90 uppercase tracking-wide font-semibold">Monto a transferir</div>
        </div>
      </div>

      {breakdown && <IessBreakdownBlock rows={breakdown} />}
      <BankAccountBlock account={transfer.account} />

      <div className="text-[12px] font-semibold mb-1">{STATUS_LABEL[transfer.status]}</div>

      {transfer.status === "REJECTED" && transfer.rejectionReason && (
        <div className="text-[12px] text-red bg-red/10 border border-red/30 rounded px-2.5 py-2 mb-2">
          Motivo: {transfer.rejectionReason}
          {canEdit && <div className="text-steel mt-1">Corregí el rol señalado y volvé a enviar el total.</div>}
        </div>
      )}
      {canEdit && transfer.status === "REJECTED" && <ResendButton apiBase={apiBase} defaultDestination={defaultDestination} onSent={onChanged} />}

      {transfer.status === "COMPLETED" && (
        <div className="text-[12px] text-steel">
          Completado{transfer.completedAt ? ` el ${new Date(transfer.completedAt).toLocaleDateString("es-EC")}` : ""}.
          {transfer.proofUrl && (
            <div className="mt-1.5">
              <ProofPreview url={transfer.proofUrl} filename={transfer.proofName ?? undefined} />
            </div>
          )}
          {transfer.confirmedWithoutProof && (
            <div className="mt-1.5 text-[12px] text-green bg-green/10 border border-green/30 rounded px-2.5 py-2">
              ✓ Confirmado sin comprobante por <b>{transfer.confirmedWithoutProofByName ?? "el admin"}</b>
              {transfer.confirmedWithoutProofAt && ` · ${fmtDateTime(transfer.confirmedWithoutProofAt)}`}
              {transfer.confirmedWithoutProofNote && <div className="mt-1 text-steel italic">&quot;{transfer.confirmedWithoutProofNote}&quot;</div>}
            </div>
          )}
          {isAdmin && (
            <button type="button" disabled={busy} className="text-[11px] text-red underline cursor-pointer mt-1.5 block disabled:opacity-50" onClick={undoCompletion}>
              {transfer.confirmedWithoutProof ? "¿Fue un error? Deshacer confirmación" : "¿Comprobante equivocado? Deshacer confirmación"}
            </button>
          )}
        </div>
      )}

      {err && <div className="text-red text-[12px] mt-2">{err}</div>}

      {isAdmin && transfer.status === "PENDING_APPROVAL" && !rejecting && (
        <div className="flex gap-2 mt-2">
          <button type="button" disabled={busy} className="text-[12px] font-bold bg-teal text-white rounded-md px-3.5 py-1.5 cursor-pointer disabled:opacity-50" onClick={approve}>
            Aprobar
          </button>
          <button type="button" disabled={busy} className="text-[12px] font-semibold text-red cursor-pointer" onClick={() => setRejecting(true)}>
            Rechazar
          </button>
        </div>
      )}
      {isAdmin && rejecting && (
        <div className="mt-2">
          <input
            className="text-[12px] rounded border border-rule bg-cloud px-2 py-1.5 w-full mb-2"
            placeholder="Motivo del rechazo — Nairoby lo va a ver"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          <div className="flex gap-2">
            <button type="button" disabled={!reason.trim() || busy} className="text-[12px] font-bold bg-red text-white rounded px-3 py-1.5 cursor-pointer disabled:opacity-50" onClick={reject}>
              Confirmar rechazo
            </button>
            <button type="button" className="text-[12px] text-steel cursor-pointer" onClick={() => { setRejecting(false); setReason(""); }}>
              Cancelar
            </button>
          </div>
        </div>
      )}

      {isAdmin && transfer.status === "APPROVED" && (
        <>
          <ProofUploader apiBase={apiBase} onSent={onChanged} />
          {(transfer.destination === "ADMIN_COMPANY" || transfer.destination === "ADMIN_PRODUBANCO") && (
            <ConfirmWithoutProofButton apiBase={apiBase} onSent={onChanged} />
          )}
        </>
      )}

      {!isAdmin && transfer.status === "PENDING_APPROVAL" && (
        <div className="text-[11.5px] text-steel-dim flex items-center gap-1.5"><Send size={11} /> Esperando aprobación del admin.</div>
      )}
      {!isAdmin && transfer.status === "APPROVED" && (
        <div className="text-[11.5px] text-steel-dim flex items-center gap-1.5"><Send size={11} /> Aprobado — el admin va a transferir.</div>
      )}
    </div>
  );
}

// Confirmado 2026-08-24: pedido explícito del usuario — el orden real es
// primero pagar, después publicar/entregar el rol a cada colaborador.
// Nairoby envía el total (suma de "Líquido a pagar" de todos los roles)
// mientras el período sigue en borrador — la cuenta destino es automática
// según el período (ver isEndOfMonthQuincena en payrollCalc.ts). El admin
// tiene 3 pasos separados: Aprobar, Rechazar (con motivo) y, aparte, subir
// el comprobante ya transferido — recién con el comprobante subido se
// habilita "Publicar" en PayrollRolesPanel. Nairoby ve todo esto en modo
// solo lectura (necesita ver también la cuenta Produbanco del admin en la
// 2da quincena, porque es ella quien entra ahí a pagar).
export function PayrollTransferPanel({
  period,
  isAdmin,
  canEdit,
  transfer,
  onChanged,
}: {
  period: string;
  isAdmin: boolean;
  canEdit: boolean;
  transfer: Transfer | null | undefined;
  onChanged: () => void;
}) {
  return (
    <TransferPanel
      apiBase={`/api/payroll/periods/${period}/transfer`}
      title="Transferencia de nómina"
      description="Cuando ya revisaste todo y está listo, enviá el total al admin para que transfiera — recién después de eso se puede publicar."
      defaultDestination={period.endsWith("-Q2") ? "ADMIN_PRODUBANCO" : "NAIROBY"}
      isAdmin={isAdmin}
      canEdit={canEdit}
      transfer={transfer}
      onChanged={onChanged}
    />
  );
}

// Confirmado 2026-08-26: pedido explícito del usuario — segundo total
// aparte del de nómina, con lo retenido de IESS de todos los colaboradores
// esa quincena (siempre fin de mes). Mismo ciclo completo de
// envío/aprobación/comprobante que la nómina, pero un registro
// (PayrollIessTransfer) totalmente independiente — nunca se mezclan. La
// cuenta destino por default es "Cuenta para recibir transferencias"
// (Pichincha), confirmado con el usuario.
export function PayrollIessTransferPanel({
  period,
  isAdmin,
  canEdit,
  transfer,
  onChanged,
  breakdown,
}: {
  period: string;
  isAdmin: boolean;
  canEdit: boolean;
  transfer: Transfer | null | undefined;
  onChanged: () => void;
  breakdown?: IessBreakdownRow[];
}) {
  return (
    <TransferPanel
      apiBase={`/api/payroll/periods/${period}/iess-transfer`}
      title="Transferencia de IESS"
      description="Total a pagar al IESS por todos los colaboradores este fin de mes (aporte personal + patronal + tarifa del gobierno). Cuando esté listo, enviá el total al admin para que transfiera a la cuenta desde la que se paga al IESS."
      defaultDestination="ADMIN_COMPANY"
      isAdmin={isAdmin}
      canEdit={canEdit}
      transfer={transfer}
      onChanged={onChanged}
      breakdown={breakdown}
    />
  );
}
