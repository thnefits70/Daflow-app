"use client";

import { useState } from "react";
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

export type Transfer = {
  status: "PENDING_APPROVAL" | "APPROVED" | "REJECTED" | "COMPLETED";
  totalAmount: number;
  destination: "NAIROBY" | "ADMIN_PRODUBANCO";
  rejectionReason: string | null;
  proofUrl: string | null;
  proofName: string | null;
  completedAt: string | null;
  account: BankAccount | null;
};

function money(n: number) {
  return `$${n.toFixed(2)}`;
}

const STATUS_LABEL: Record<Transfer["status"], string> = {
  PENDING_APPROVAL: "Pendiente de aprobación",
  APPROVED: "Aprobado — falta transferir",
  REJECTED: "Rechazado",
  COMPLETED: "Completado",
};

function BankAccountBlock({ account }: { account: BankAccount | null }) {
  const [show, setShow] = useState(false);
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

function ProofUploader({ period, onSent }: { period: string; onSent: () => void }) {
  const [proofUrl, setProofUrl] = useState<string | null>(null);
  const [proofName, setProofName] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState("");

  async function handleFile(file: File) {
    setUploading(true);
    setErr("");
    const res = await uploadFile(file, "payroll-transfer-proofs");
    setUploading(false);
    if (!res.ok) { setErr(res.error); return; }
    setProofUrl(res.url);
    setProofName(res.name);
  }
  const { onPaste, onMouseEnter, onMouseLeave } = usePasteFile(handleFile);

  async function submit() {
    if (!proofUrl) return;
    setSubmitting(true);
    setErr("");
    const res = await fetch(`/api/payroll/periods/${period}/transfer/proof`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ proofUrl, proofName }),
    });
    setSubmitting(false);
    if (!res.ok) { setErr("No se pudo enviar el comprobante — intentá de nuevo."); return; }
    onSent();
  }

  return (
    <div onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave} onPaste={onPaste} className="mt-2.5 pt-2.5 border-t border-rule">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-steel mb-1.5">Comprobante de la transferencia — Ctrl+V para pegar</div>
      {proofUrl ? (
        <div className="flex items-center gap-2">
          <ProofPreview url={proofUrl} filename={proofName ?? undefined} />
          <button type="button" className="text-[11px] text-steel-dim underline cursor-pointer" onClick={() => { setProofUrl(null); setProofName(null); }}>Quitar</button>
        </div>
      ) : (
        <label className="flex items-center justify-center gap-1.5 text-[11.5px] text-steel-dim border-[1.5px] border-dashed border-rule rounded-md px-3 py-4 cursor-pointer text-center">
          {uploading ? "Subiendo…" : "Pegá con Ctrl+V, o hacé clic para elegir un archivo"}
          <input type="file" accept="image/*,application/pdf" className="hidden" onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])} />
        </label>
      )}
      {err && <div className="text-red text-[11.5px] mt-1.5">{err}</div>}
      <button type="button" disabled={!proofUrl || submitting} className="text-[12px] font-bold bg-teal text-white rounded-md px-3.5 py-1.5 cursor-pointer disabled:opacity-40 mt-2.5" onClick={submit}>
        {submitting ? "Enviando…" : "Confirmar transferencia hecha"}
      </button>
    </div>
  );
}

function ResendButton({ period, onSent }: { period: string; onSent: () => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function send() {
    setBusy(true);
    setErr("");
    const res = await fetch(`/api/payroll/periods/${period}/transfer/confirm`, { method: "POST" });
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
      {err && <div className="text-red text-[12px] mb-1.5">{err}</div>}
      <button type="button" disabled={busy} className="text-[12px] font-bold bg-teal text-white rounded-md px-3.5 py-1.5 cursor-pointer disabled:opacity-50" onClick={send}>
        {busy ? "Enviando…" : "Enviar total para transferir"}
      </button>
    </div>
  );
}

function SendTotalPrompt({ period, onSent }: { period: string; onSent: () => void }) {
  return (
    <div className="bg-surface border border-rule rounded-md p-3.5 mb-4">
      <div className="font-bold text-[13.5px] mb-1">Transferencia de nómina</div>
      <div className="text-[12px] text-steel mb-2.5">
        Cuando ya revisaste todo y está listo, enviá el total al admin para que transfiera — recién después de eso se puede publicar.
      </div>
      <ResendButton period={period} onSent={onSent} />
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
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function approve() {
    setBusy(true);
    setErr("");
    const res = await fetch(`/api/payroll/periods/${period}/transfer/approve`, { method: "POST" });
    setBusy(false);
    if (!res.ok) { setErr("No se pudo aprobar."); return; }
    onChanged();
  }

  async function reject() {
    if (!reason.trim()) return;
    setBusy(true);
    setErr("");
    const res = await fetch(`/api/payroll/periods/${period}/transfer/reject`, {
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

  if (transfer === undefined) return null;
  if (transfer === null) {
    if (canEdit) return <SendTotalPrompt period={period} onSent={onChanged} />;
    return null;
  }

  const destinationLabel = transfer.destination === "NAIROBY" ? "Cuenta de Nairoby (1ra quincena)" : "Cuenta Produbanco del admin (fin de mes)";

  return (
    <div className="bg-surface border border-rule rounded-md p-3.5 mb-4">
      <div className="flex items-center justify-between gap-2 mb-2.5">
        <div>
          <div className="font-bold text-[13.5px]">Transferencia de nómina</div>
          <div className="text-[10.5px] text-steel">{destinationLabel}</div>
        </div>
        <div className="flex flex-col items-end gap-0.5 bg-teal/15 border border-teal/40 rounded-md px-2.5 py-1">
          <div className="text-[17px] font-extrabold tabular-nums text-teal">{money(transfer.totalAmount)}</div>
          <div className="text-[9.5px] text-teal/90 uppercase tracking-wide font-semibold">Total de la quincena</div>
        </div>
      </div>

      <BankAccountBlock account={transfer.account} />

      <div className="text-[12px] font-semibold mb-1">{STATUS_LABEL[transfer.status]}</div>

      {transfer.status === "REJECTED" && transfer.rejectionReason && (
        <div className="text-[12px] text-red bg-red/10 border border-red/30 rounded px-2.5 py-2 mb-2">
          Motivo: {transfer.rejectionReason}
          {canEdit && <div className="text-steel mt-1">Corregí el rol señalado y volvé a enviar el total.</div>}
        </div>
      )}
      {canEdit && transfer.status === "REJECTED" && <ResendButton period={period} onSent={onChanged} />}

      {transfer.status === "COMPLETED" && (
        <div className="text-[12px] text-steel">
          Completado{transfer.completedAt ? ` el ${new Date(transfer.completedAt).toLocaleDateString("es-EC")}` : ""}.
          {transfer.proofUrl && (
            <div className="mt-1.5">
              <ProofPreview url={transfer.proofUrl} filename={transfer.proofName ?? undefined} />
            </div>
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

      {isAdmin && transfer.status === "APPROVED" && <ProofUploader period={period} onSent={onChanged} />}

      {!isAdmin && transfer.status === "PENDING_APPROVAL" && (
        <div className="text-[11.5px] text-steel-dim flex items-center gap-1.5"><Send size={11} /> Esperando aprobación del admin.</div>
      )}
      {!isAdmin && transfer.status === "APPROVED" && (
        <div className="text-[11.5px] text-steel-dim flex items-center gap-1.5"><Send size={11} /> Aprobado — el admin va a transferir.</div>
      )}
    </div>
  );
}
