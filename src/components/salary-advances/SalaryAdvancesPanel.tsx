"use client";

import { useEffect, useState } from "react";
import { Banknote } from "lucide-react";

type BankAccount = {
  bankName: string; bankAccountType: string; bankAccountNumber: string; bankAccountHolder: string;
  holderIdType: "RUC" | "CEDULA" | null; holderIdNumber: string | null;
} | null;

type Advance = {
  id: string; amount: number; installments: number; status: string;
  justification: string | null; transferProofUrl: string | null; firstPayoutMonth: string | null;
};

function money(n: number) {
  return `$${n.toFixed(2)}`;
}

const STATUS_LABEL: Record<string, { label: string; color: string }> = {
  PENDING: { label: "Esperando aprobación", color: "#D9A441" },
  APPROVED: { label: "Aprobado y transferido", color: "#22C55E" },
  REJECTED: { label: "Rechazado", color: "#C4453A" },
};

function BankAccountForm({ account, onSaved }: { account: BankAccount; onSaved: () => void }) {
  const [bankName, setBankName] = useState(account?.bankName ?? "");
  const [bankAccountType, setBankAccountType] = useState(account?.bankAccountType ?? "Ahorros");
  const [bankAccountNumber, setBankAccountNumber] = useState(account?.bankAccountNumber ?? "");
  const [bankAccountHolder, setBankAccountHolder] = useState(account?.bankAccountHolder ?? "");
  const [holderIdNumber, setHolderIdNumber] = useState(account?.holderIdNumber ?? "");
  const [bankNames, setBankNames] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetch("/api/employee-bank-account/bank-names").then((r) => (r.ok ? r.json() : [])).then(setBankNames);
  }, []);

  async function save() {
    if (!bankName.trim() || !bankAccountNumber.trim() || !bankAccountHolder.trim() || !holderIdNumber.trim()) return;
    setBusy(true);
    await fetch("/api/employee-bank-account", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bankName: bankName.trim(), bankAccountType, bankAccountNumber: bankAccountNumber.trim(), bankAccountHolder: bankAccountHolder.trim(), holderIdType: "CEDULA", holderIdNumber: holderIdNumber.trim() }),
    });
    setBusy(false);
    setSaved(true);
    onSaved();
  }

  return (
    <div className="bg-surface border border-rule rounded-md p-4 mb-4">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-steel mb-3">Mi cuenta bancaria</div>
      <div className="flex flex-col gap-2 max-w-sm">
        <input list="bank-names-datalist" className="text-[12.5px] rounded border border-rule bg-cloud px-2.5 py-1.5" placeholder="Banco" value={bankName} onChange={(e) => setBankName(e.target.value)} />
        <datalist id="bank-names-datalist">{bankNames.map((n) => (<option key={n} value={n} />))}</datalist>
        <div className="flex gap-2">
          <button type="button" onClick={() => setBankAccountType("Ahorros")} className={`text-[12px] font-semibold rounded px-3 py-1.5 border cursor-pointer ${bankAccountType === "Ahorros" ? "border-teal text-teal bg-teal/10" : "border-rule text-steel"}`}>Ahorros</button>
          <button type="button" onClick={() => setBankAccountType("Corriente")} className={`text-[12px] font-semibold rounded px-3 py-1.5 border cursor-pointer ${bankAccountType === "Corriente" ? "border-teal text-teal bg-teal/10" : "border-rule text-steel"}`}>Corriente</button>
        </div>
        <input className="text-[12.5px] rounded border border-rule bg-cloud px-2.5 py-1.5" placeholder="N° de cuenta" value={bankAccountNumber} onChange={(e) => setBankAccountNumber(e.target.value)} />
        <input className="text-[12.5px] rounded border border-rule bg-cloud px-2.5 py-1.5" placeholder="Nombre del titular" value={bankAccountHolder} onChange={(e) => setBankAccountHolder(e.target.value)} />
        <input className="text-[12.5px] rounded border border-rule bg-cloud px-2.5 py-1.5" placeholder="N° de cédula" value={holderIdNumber} onChange={(e) => setHolderIdNumber(e.target.value)} />
        <button type="button" disabled={busy} className="text-[12px] font-bold bg-blue text-white rounded px-3 py-1.5 cursor-pointer disabled:opacity-50 self-start" onClick={save}>
          {busy ? "Guardando…" : "Guardar cuenta"}
        </button>
        {saved && <div className="text-green text-[11.5px]">Guardado.</div>}
      </div>
    </div>
  );
}

export function SalaryAdvancesPanel() {
  const [account, setAccount] = useState<BankAccount>(null);
  const [advances, setAdvances] = useState<Advance[] | null>(null);
  const [amount, setAmount] = useState("");
  const [justification, setJustification] = useState("");
  const [installments, setInstallments] = useState(1);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  function load() {
    fetch("/api/employee-bank-account").then((r) => (r.ok ? r.json() : null)).then(setAccount);
    fetch("/api/salary-advances").then((r) => (r.ok ? r.json() : [])).then(setAdvances);
  }
  useEffect(load, []);

  const amt = Number(amount);
  const needsJustification = amt > 100;
  const canInstallments = amt > 50;

  async function submit() {
    if (!amt || amt <= 0) return;
    setBusy(true);
    setErr("");
    const res = await fetch("/api/salary-advances", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ amount: amt, justification: justification.trim() || undefined, installments: canInstallments ? installments : 1 }),
    });
    setBusy(false);
    const data = await res.json().catch(() => null);
    if (!res.ok) { setErr(data?.error ?? "No se pudo enviar."); return; }
    setAmount(""); setJustification(""); setInstallments(1);
    load();
  }

  if (!advances) return <div className="text-steel text-[13px]">Cargando…</div>;

  return (
    <div>
      <BankAccountForm account={account} onSaved={load} />

      <div className="bg-surface border border-rule rounded-md p-4 mb-4">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-steel mb-3 flex items-center gap-1.5">
          <Banknote size={13} /> Solicitar anticipo
        </div>
        {!account ? (
          <div className="text-[12.5px] text-steel-dim">Primero registrá tu cuenta bancaria arriba.</div>
        ) : (
          <div className="flex flex-col gap-2 max-w-sm">
            <input className="text-[13px] rounded border border-rule bg-cloud px-2.5 py-1.5" type="number" step="0.01" placeholder="Monto" value={amount} onChange={(e) => setAmount(e.target.value)} />
            {canInstallments && (
              <div>
                <label className="block mb-1 text-[10px] font-semibold uppercase tracking-wide text-steel">Pagarlo en</label>
                <div className="flex gap-2">
                  {[1, 2, 3].map((n) => (
                    <button key={n} type="button" onClick={() => setInstallments(n)} className={`text-[12px] font-semibold rounded px-3 py-1.5 border cursor-pointer ${installments === n ? "border-teal text-teal bg-teal/10" : "border-rule text-steel"}`}>
                      {n === 1 ? "1 cuota" : `${n} cuotas`}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {needsJustification && (
              <textarea className="text-[12.5px] rounded border border-rule bg-cloud px-2.5 py-1.5" placeholder="Contá brevemente el motivo (obligatorio arriba de $100)" value={justification} onChange={(e) => setJustification(e.target.value)} rows={2} />
            )}
            {err && <div className="text-red text-[12.5px]">{err}</div>}
            <button type="button" disabled={busy || !amt} className="text-[13px] font-bold bg-blue text-white rounded-md px-4 py-2 cursor-pointer disabled:opacity-40 self-start" onClick={submit}>
              {busy ? "Enviando…" : "Enviar solicitud"}
            </button>
          </div>
        )}
      </div>

      <div className="bg-surface border border-rule rounded-md p-4">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-steel mb-3">Mis anticipos</div>
        {advances.length === 0 && <div className="text-steel text-[12.5px]">Todavía no pediste ningún anticipo.</div>}
        <div className="flex flex-col gap-2">
          {advances.map((a) => {
            const s = STATUS_LABEL[a.status];
            return (
              <div key={a.id} className="flex items-center gap-3 text-[12.5px] py-2 border-b border-rule last:border-0 flex-wrap">
                <span className="font-bold tabular-nums">{money(a.amount)}</span>
                {a.installments > 1 && <span className="text-steel-dim">({a.installments} cuotas)</span>}
                <span className="text-[10.5px] font-semibold rounded-full px-2 py-0.5" style={{ color: s.color, border: `1px solid ${s.color}` }}>{s.label}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
