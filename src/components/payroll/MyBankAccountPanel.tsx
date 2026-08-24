"use client";

import { useEffect, useState } from "react";
import { Landmark, CheckCircle2, Circle, Plus } from "lucide-react";

type BankAccount = {
  id: string; bankName: string; bankAccountType: string; bankAccountNumber: string; bankAccountHolder: string;
  holderIdType: "RUC" | "CEDULA" | null; holderIdNumber: string | null; isSelected: boolean;
};

function BankAccountForm({ hasExisting, onSaved, onCancel }: { hasExisting: boolean; onSaved: () => void; onCancel: () => void }) {
  const [bankName, setBankName] = useState("");
  const [bankAccountType, setBankAccountType] = useState("Ahorros");
  const [bankAccountNumber, setBankAccountNumber] = useState("");
  const [bankAccountHolder, setBankAccountHolder] = useState("");
  const [holderIdNumber, setHolderIdNumber] = useState("");
  const [bankNames, setBankNames] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/employee-bank-account/bank-names").then((r) => (r.ok ? r.json() : [])).then(setBankNames);
  }, []);

  async function save() {
    if (!bankName.trim() || !bankAccountNumber.trim() || !bankAccountHolder.trim() || !holderIdNumber.trim()) return;
    setBusy(true);
    await fetch("/api/employee-bank-account", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bankName: bankName.trim(), bankAccountType, bankAccountNumber: bankAccountNumber.trim(), bankAccountHolder: bankAccountHolder.trim(), holderIdType: "CEDULA", holderIdNumber: holderIdNumber.trim() }),
    });
    setBusy(false);
    onSaved();
  }

  return (
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
      <div className="flex gap-2">
        <button type="button" disabled={busy} className="text-[12px] font-bold bg-blue text-white rounded px-3 py-1.5 cursor-pointer disabled:opacity-50" onClick={save}>
          {busy ? "Guardando…" : "Guardar cuenta"}
        </button>
        {hasExisting && (
          <button type="button" disabled={busy} className="text-[12px] font-semibold text-steel rounded px-3 py-1.5 cursor-pointer" onClick={onCancel}>
            Cancelar
          </button>
        )}
      </div>
    </div>
  );
}

// Confirmado 2026-08-21: pedido explícito del usuario — cada colaborador
// matricula su cuenta bancaria UNA sola vez acá (Mi Nómina), y esa misma
// cuenta (la marcada isSelected) es la que Nairoby ve desplegable en cada
// tarjeta de rol de pago (PayrollRolesPanel) para saber a dónde transferir.
// Reusa /api/employee-bank-account, el mismo endpoint que ya usaba el flujo
// de anticipos — registrar acá o desde un anticipo actualiza la misma cuenta.
export function MyBankAccountPanel() {
  const [accounts, setAccounts] = useState<BankAccount[] | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState(false);

  function load() {
    fetch("/api/employee-bank-account").then((r) => (r.ok ? r.json() : [])).then((list: BankAccount[]) => {
      setAccounts(list);
      setShowForm(false);
    });
  }
  useEffect(load, []);

  async function selectAccount(id: string) {
    setBusy(true);
    await fetch("/api/employee-bank-account", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ selectId: id }),
    });
    setBusy(false);
    load();
  }

  if (accounts === null) return null;

  return (
    <div className="bg-surface border border-rule rounded-md p-4 mb-4.5">
      <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-steel mb-1">
        <Landmark size={12} /> Mi cuenta bancaria
      </div>
      <div className="text-[12px] text-steel-dim mb-3">
        La cuenta activa es a donde se transfiere tu sueldo y anticipos. Regístrala una sola vez y mantenla actualizada.
      </div>

      {accounts.length > 0 && !showForm && (
        <div className="flex flex-col gap-2 max-w-sm">
          {accounts.map((a) => (
            <button
              key={a.id}
              type="button"
              disabled={busy || a.isSelected}
              onClick={() => selectAccount(a.id)}
              className={`text-left rounded-md border px-3 py-2.5 cursor-pointer disabled:cursor-default ${a.isSelected ? "border-teal bg-teal/10" : "border-rule hover:border-steel"}`}
            >
              <div className="flex items-center gap-2">
                {a.isSelected ? <CheckCircle2 size={15} className="text-teal shrink-0" /> : <Circle size={15} className="text-steel-dim shrink-0" />}
                <span className="text-[12.5px] font-semibold text-ink">{a.bankName}</span>
                <span className="text-[11px] text-steel-dim">{a.bankAccountType}</span>
                {a.isSelected && <span className="ml-auto text-[10px] font-semibold text-teal uppercase tracking-wide">Cuenta activa</span>}
              </div>
              <div className="text-[12px] text-steel-dim mt-0.5">{a.bankAccountNumber} · {a.bankAccountHolder}</div>
            </button>
          ))}
          <button type="button" onClick={() => setShowForm(true)} className="flex items-center gap-1.5 text-[12px] font-semibold text-blue cursor-pointer self-start mt-1">
            <Plus size={13} /> Agregar otra cuenta
          </button>
          {accounts.length > 1 && (
            <div className="text-[11px] text-steel-dim">Solo la cuenta activa se usa para transferirte.</div>
          )}
        </div>
      )}

      {(accounts.length === 0 || showForm) && (
        <BankAccountForm hasExisting={accounts.length > 0} onSaved={load} onCancel={() => setShowForm(false)} />
      )}
    </div>
  );
}
