"use client";

import { useState } from "react";
import { Landmark, ChevronDown, CheckCircle2 } from "lucide-react";
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

export type PayoutRole = {
  id: string;
  employeeName: string;
  position: string | null;
  netTotal: number;
  bankAccount: BankAccount | null;
  paidAt: string | null;
  paidProofUrl: string | null;
  paidProofName: string | null;
};

function money(n: number) {
  return `$${n.toFixed(2)}`;
}

type VerifyResult = { readAmount: number | null; matches: boolean; note: string };

function PayoutUploader({ roleId, expectedAmount, onSent }: { roleId: string; expectedAmount: number; onSent: () => void }) {
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
    const res = await uploadFile(file, "payroll-individual-payment-proofs");
    setUploading(false);
    if (!res.ok) { setErr(res.error); return; }
    setProofUrl(res.url);
    setProofName(res.name);

    setVerifying(true);
    const verifyRes = await fetch(`/api/payroll/roles/${roleId}/individual-payment/verify-proof`, {
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
    const res = await fetch(`/api/payroll/roles/${roleId}/individual-payment`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ proofUrl, proofName }),
    });
    setSubmitting(false);
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setErr(data?.error ?? "No se pudo confirmar el pago — intentá de nuevo.");
      return;
    }
    onSent();
  }

  return (
    <div onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave} onPaste={onPaste} className="mt-2.5 pt-2.5 border-t border-rule">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-steel mb-1.5">Comprobante — Ctrl+V para pegar</div>
      {proofUrl ? (
        <div className="flex items-center gap-2">
          <ProofPreview url={proofUrl} filename={proofName ?? undefined} />
          <button type="button" className="text-[11px] text-steel-dim underline cursor-pointer" onClick={() => { setProofUrl(null); setProofName(null); setVerify(null); }}>Quitar</button>
        </div>
      ) : (
        <div>
          <label className="flex items-center justify-center gap-1.5 text-[11.5px] text-steel-dim border-[1.5px] border-dashed border-rule rounded-md px-3 py-3.5 cursor-pointer text-center">
            {uploading ? "Subiendo…" : "Pegá con Ctrl+V, o hacé clic para elegir un archivo"}
            <input type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])} />
          </label>
          <label className="flex items-center gap-1 mt-1 text-[10.5px] text-steel-dim cursor-pointer hover:text-teal w-fit mx-auto justify-center">
            ¿Es un PDF? Subir documento
            <input type="file" accept="application/pdf" className="hidden" onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])} />
          </label>
        </div>
      )}
      {err && <div className="text-red text-[11.5px] mt-1.5">{err}</div>}
      {verifying && <div className="text-[11.5px] text-steel-dim mt-1.5">Verificando con IA…</div>}
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
      <button type="button" disabled={!proofUrl || submitting || blockedByMismatch} className="text-[11.5px] font-bold bg-teal text-white rounded-md px-3.5 py-1.5 cursor-pointer disabled:opacity-40 mt-2.5" onClick={submit}>
        {submitting ? "Confirmando…" : `Confirmar pago (${money(expectedAmount)})`}
      </button>
      {blockedByMismatch && (
        <div className="text-[11px] text-steel-dim mt-1">Quitá el comprobante y subí uno que sí coincida para poder confirmar.</div>
      )}
    </div>
  );
}

function BankAccountToggle({ account }: { account: BankAccount | null }) {
  const [show, setShow] = useState(false);
  return (
    <div className="mt-2">
      <button
        type="button"
        className={`flex items-center gap-1.5 text-[10.5px] font-semibold rounded px-2 py-1 cursor-pointer border ${account ? "text-steel border-rule" : "text-gold border-gold/40"}`}
        style={account ? undefined : { color: "#D9A441" }}
        onClick={() => setShow((s) => !s)}
      >
        <Landmark size={11} />
        {account ? "Cuenta bancaria" : "Sin cuenta bancaria registrada"}
        <ChevronDown size={11} className={show ? "rotate-180" : ""} />
      </button>
      {show && (
        <div className="mt-1.5 p-2.5 rounded bg-cloud border border-rule text-[11.5px] flex flex-col gap-1">
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
            <span className="text-steel-dim italic">Este colaborador todavía no registró su cuenta bancaria.</span>
          )}
        </div>
      )}
    </div>
  );
}

function PayoutRow({ role, canEdit, onChanged }: { role: PayoutRole; canEdit: boolean; onChanged: () => void }) {
  const [undoing, setUndoing] = useState(false);
  const paid = !!role.paidAt;

  async function undo() {
    setUndoing(true);
    await fetch(`/api/payroll/roles/${role.id}/individual-payment`, { method: "DELETE" });
    setUndoing(false);
    onChanged();
  }

  return (
    <div className={`border rounded-md p-3 ${paid ? "border-green/30 bg-green/5" : "border-rule bg-cloud"}`}>
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="font-bold text-[12.5px]">{role.employeeName}</div>
          {role.position && <div className="text-[10px] text-steel">{role.position}</div>}
        </div>
        <div className="text-[13.5px] font-extrabold tabular-nums">{money(role.netTotal)}</div>
      </div>

      <BankAccountToggle account={role.bankAccount} />

      {paid ? (
        <div className="mt-2.5 pt-2 border-t border-rule">
          <div className="text-[11.5px] text-green font-semibold flex items-center gap-1.5">
            <CheckCircle2 size={13} /> Pagado{role.paidAt ? ` — ${new Date(role.paidAt).toLocaleDateString("es-EC")}` : ""}
          </div>
          {role.paidProofUrl && (
            <div className="mt-1.5">
              <ProofPreview url={role.paidProofUrl} filename={role.paidProofName ?? undefined} />
            </div>
          )}
          {canEdit && (
            <button type="button" disabled={undoing} className="text-[10.5px] text-steel-dim underline cursor-pointer mt-1.5 disabled:opacity-50" onClick={undo}>
              {undoing ? "Deshaciendo…" : "Deshacer — subí un comprobante equivocado"}
            </button>
          )}
        </div>
      ) : canEdit ? (
        <PayoutUploader roleId={role.id} expectedAmount={role.netTotal} onSent={onChanged} />
      ) : (
        <div className="text-[11px] mt-2.5 pt-2 border-t border-rule" style={{ color: "#D9A441" }}>Pendiente de pago</div>
      )}
    </div>
  );
}

// Confirmado 2026-08-24: pedido explícito del usuario — una vez transferido
// el total (transfer.status === "COMPLETED"), Nairoby paga a cada
// colaborador por separado (desde su propia cuenta o desde la Produbanco del
// admin, según el destino que se haya usado) y quiere subir el comprobante
// de CADA transferencia individual ahí mismo, con la IA validando cada una
// contra el líquido a pagar de esa persona — no solo el total, como ya hacía
// PayrollTransferPanel. Nairoby (canEdit) sube y confirma; el admin ve todo
// en modo solo lectura, igual que el resto de este módulo.
export function IndividualPayoutsPanel({ roles, canEdit, onChanged }: { roles: PayoutRole[]; canEdit: boolean; onChanged: () => void }) {
  const paidCount = roles.filter((r) => r.paidAt).length;
  return (
    <div className="bg-surface border border-rule rounded-md p-3.5 mb-4">
      <div className="flex items-center justify-between gap-2 mb-1">
        <div className="font-bold text-[13.5px]">Pagos individuales a colaboradores</div>
        <span className={`text-[11px] font-semibold rounded-full px-2 py-0.5 ${paidCount === roles.length ? "text-green bg-green/10" : "text-steel bg-cloud"}`}>
          {paidCount}/{roles.length} pagados
        </span>
      </div>
      <div className="text-[11.5px] text-steel mb-3">
        Ya tenés el total transferido — subí acá el comprobante de cada transferencia individual y la IA lo valida contra lo que le corresponde a esa persona.
      </div>
      <div className="flex flex-col gap-2">
        {roles.map((r) => (
          <PayoutRow key={r.id} role={r} canEdit={canEdit} onChanged={onChanged} />
        ))}
      </div>
    </div>
  );
}
