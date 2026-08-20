"use client";

import { useEffect, useRef, useState } from "react";
import { compressImage } from "@/lib/compressImage";
import { uploadFile } from "@/lib/uploadFile";
import { usePasteFile } from "@/lib/usePasteFile";

type Advance = {
  id: string; amount: number; installments: number; justification: string | null; reason: "EMERGENCIA_FAMILIAR" | "OTRO" | null;
  employee: { name: string };
  bankAccount: { bankName: string; bankAccountType: string; bankAccountNumber: string; bankAccountHolder: string; holderIdNumber: string | null } | null;
};

const REASON_LABEL: Record<string, string> = { EMERGENCIA_FAMILIAR: "Emergencia familiar", OTRO: "Otro motivo" };

function money(n: number) {
  return `$${n.toFixed(2)}`;
}

// Confirmado 2026-08-18: admin sube el comprobante de transferencia al
// aprobar — recién ahí arranca el calendario de cuotas.
export function SalaryAdvanceApprovalPanel() {
  const [items, setItems] = useState<Advance[] | null>(null);
  const [proofUrls, setProofUrls] = useState<Record<string, string>>({});
  const [uploadingId, setUploadingId] = useState<string | null>(null);
  const [verifyingId, setVerifyingId] = useState<string | null>(null);
  const [verifyResults, setVerifyResults] = useState<Record<string, { matches: boolean; note: string } | null>>({});
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [busy, setBusy] = useState(false);
  const proofRowIdRef = useRef<string | null>(null);
  const proofInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  function load() {
    fetch("/api/salary-advances/pending").then((r) => (r.ok ? r.json() : [])).then(setItems);
  }
  useEffect(load, []);

  async function verifyProof(id: string, url: string, expectedAmount: number) {
    setVerifyingId(id);
    setVerifyResults((v) => ({ ...v, [id]: null }));
    const res = await fetch("/api/salary-advances/verify-proof", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ proofUrl: url, expectedAmount }),
    });
    const data = await res.json().catch(() => null);
    setVerifyingId(null);
    if (res.ok) setVerifyResults((v) => ({ ...v, [id]: { matches: data.matches, note: data.note } }));
  }

  async function handleProofFile(id: string, file: File, expectedAmount: number) {
    setUploadingId(id);
    const compressed = await compressImage(file);
    const result = await uploadFile(compressed, "salary-advance-proofs");
    setUploadingId(null);
    if (result.ok) {
      setProofUrls((p) => ({ ...p, [id]: result.url }));
      verifyProof(id, result.url, expectedAmount);
    }
  }

  const { onPaste: onPasteProof, onMouseEnter: armProofPaste, onMouseLeave: disarmProofPaste } = usePasteFile((file) => {
    const id = proofRowIdRef.current;
    const item = items?.find((a) => a.id === id);
    if (id && item) handleProofFile(id, file, item.amount);
  });

  function clearProof(id: string) {
    setProofUrls((p) => { const rest = { ...p }; delete rest[id]; return rest; });
    setVerifyResults((v) => ({ ...v, [id]: null }));
  }

  async function approve(id: string) {
    const proof = proofUrls[id];
    if (!proof) return;
    if (verifyResults[id]?.matches === false) return;
    setBusy(true);
    await fetch(`/api/salary-advances/${id}/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ transferProofUrl: proof }),
    });
    setBusy(false);
    load();
  }

  async function reject(id: string) {
    if (!rejectReason.trim()) return;
    setBusy(true);
    await fetch(`/api/salary-advances/${id}/reject`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: rejectReason.trim() }),
    });
    setBusy(false);
    setRejecting(null);
    setRejectReason("");
    load();
  }

  if (!items) return <div className="text-steel text-[13px]">Cargando…</div>;

  return (
    <div>
      <div className="text-[11px] font-semibold uppercase tracking-wide text-steel mb-3">Anticipos pendientes ({items.length})</div>
      {items.length === 0 && <div className="border-[1.5px] border-dashed border-rule rounded-md p-6 text-center text-steel text-[13px]">Nada pendiente por ahora.</div>}
      <div className="flex flex-col gap-3">
        {items.map((a) => (
          <div key={a.id} className="bg-surface border border-rule rounded-md p-3.5">
            <div className="font-bold text-[13px]">{a.employee.name} — {money(a.amount)}{a.installments > 1 ? ` (${a.installments} cuotas)` : ""}</div>
            {a.reason && <div className="text-[11.5px] text-steel mt-0.5">Motivo: {REASON_LABEL[a.reason] ?? a.reason}</div>}
            {a.justification && <div className="text-[12px] text-steel-dim mt-0.5">"{a.justification}"</div>}
            {a.bankAccount ? (
              <div className="text-[11.5px] text-steel mt-1.5">
                {a.bankAccount.bankName} · {a.bankAccount.bankAccountType} · {a.bankAccount.bankAccountNumber} · {a.bankAccount.bankAccountHolder}{a.bankAccount.holderIdNumber ? ` · CI ${a.bankAccount.holderIdNumber}` : ""}
              </div>
            ) : (
              <div className="text-[11.5px] text-red mt-1.5">No tiene cuenta bancaria registrada.</div>
            )}

            {rejecting === a.id ? (
              <div className="mt-3 pt-3 border-t border-rule">
                <input className="text-[12px] rounded border border-rule bg-cloud px-2 py-1.5 w-full mb-2" placeholder="Motivo del rechazo" value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} />
                <div className="flex gap-2">
                  <button type="button" disabled={busy || !rejectReason.trim()} className="text-[12px] font-bold bg-red text-white rounded px-3 py-1.5 cursor-pointer disabled:opacity-50" onClick={() => reject(a.id)}>Confirmar rechazo</button>
                  <button type="button" className="text-[12px] text-steel cursor-pointer" onClick={() => { setRejecting(null); setRejectReason(""); }}>Cancelar</button>
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-1.5 mt-2.5">
                <div className="flex items-center gap-2 flex-wrap">
                  {proofUrls[a.id] ? (
                    <>
                      {verifyingId === a.id ? (
                        <span className="text-[11.5px] text-steel">Verificando comprobante…</span>
                      ) : verifyResults[a.id]?.matches ? (
                        <span className="text-[11.5px] text-green font-semibold">Comprobante listo — coincide</span>
                      ) : verifyResults[a.id]?.matches === false ? (
                        <span className="text-[11.5px] text-red font-semibold">No coincide</span>
                      ) : (
                        <span className="text-[11.5px] text-green font-semibold">Comprobante listo</span>
                      )}
                      <button type="button" className="text-[11px] underline decoration-dotted text-steel opacity-80 hover:opacity-100 cursor-pointer" onClick={() => clearProof(a.id)}>Cambiar</button>
                    </>
                  ) : (
                    <label
                      tabIndex={0}
                      onPaste={onPasteProof}
                      onMouseEnter={() => { proofRowIdRef.current = a.id; armProofPaste(); }}
                      onMouseLeave={disarmProofPaste}
                      onClick={(e) => e.preventDefault()}
                      className="flex items-center gap-1.5 border-[1.5px] border-dashed border-rule rounded px-2.5 py-1.5 text-[11.5px] text-steel cursor-pointer hover:border-teal focus:border-teal focus:outline-none"
                    >
                      {uploadingId === a.id ? "Subiendo…" : "Pega el comprobante aquí (Ctrl+V)"}
                      <button
                        type="button"
                        className="text-[11px] font-semibold text-blue underline decoration-dotted cursor-pointer"
                        onClick={(e) => { e.stopPropagation(); proofInputRefs.current[a.id]?.click(); }}
                      >
                        o selecciona un archivo
                      </button>
                      <input
                        ref={(el) => { proofInputRefs.current[a.id] = el; }}
                        type="file"
                        accept="image/*,application/pdf"
                        className="hidden"
                        onChange={(e) => e.target.files?.[0] && handleProofFile(a.id, e.target.files[0], a.amount)}
                      />
                    </label>
                  )}
                  <button type="button" disabled={busy || !proofUrls[a.id] || verifyResults[a.id]?.matches === false || verifyingId === a.id} className="text-[12px] font-bold bg-green text-white rounded-md px-3.5 py-1.5 cursor-pointer disabled:opacity-40" onClick={() => approve(a.id)}>Aprobar y transferir</button>
                  <button type="button" disabled={busy} className="text-[12px] font-semibold text-red cursor-pointer" onClick={() => setRejecting(a.id)}>Rechazar</button>
                </div>
                {verifyResults[a.id] && <div className={`text-[11px] ${verifyResults[a.id]?.matches ? "text-steel" : "text-red"}`}>{verifyResults[a.id]?.note}</div>}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
