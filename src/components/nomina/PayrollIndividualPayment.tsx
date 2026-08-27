"use client";

import { useState } from "react";
import { ProofPreview } from "@/components/shared/ProofPreview";
import { usePasteFile } from "@/lib/usePasteFile";
import { uploadFile } from "@/lib/uploadFile";

function money(n: number) {
  return `$${n.toFixed(2)}`;
}

type VerifyResult = { readAmount: number | null; matches: boolean; note: string };

// Confirmado 2026-08-24: pedido explícito del usuario — el comprobante de
// pago a cada colaborador va DENTRO de la misma tarjeta detallada de esa
// persona (RoleCard, junto a "Líquido a pagar"), no en una sección aparte.
// Este componente es solo el bloque de subida+verificación, para que
// RoleCard lo pueda insertar donde corresponde.
export function PayoutUploader({ roleId, expectedAmount, onSent }: { roleId: string; expectedAmount: number; onSent: () => void }) {
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
    <div onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave} onPaste={onPaste}>
      {proofUrl ? (
        <div className="flex items-center gap-2">
          <ProofPreview url={proofUrl} filename={proofName ?? undefined} />
          <button type="button" className="text-[11px] text-steel-dim underline cursor-pointer" onClick={() => { setProofUrl(null); setProofName(null); setVerify(null); }}>Quitar</button>
        </div>
      ) : (
        <div>
          <div className="flex items-center justify-center gap-1.5 text-[11.5px] text-steel-dim border-[1.5px] border-dashed border-rule rounded-md px-3 py-3 text-center">
            {uploading ? (
              "Subiendo…"
            ) : (
              <span>
                Pegá con Ctrl+V, o{" "}
                <label className="underline cursor-pointer hover:text-teal">
                  hacé clic para elegir un archivo
                  <input type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])} />
                </label>
              </span>
            )}
          </div>
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
