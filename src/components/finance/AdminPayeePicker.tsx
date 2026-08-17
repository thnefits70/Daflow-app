"use client";

import { useState } from "react";
import { Search, Plus, CheckCircle2, Trash2 } from "lucide-react";

export type PayeeBankAccountDTO = {
  id: string;
  bankName: string;
  bankAccountType: string;
  bankAccountNumber: string;
  bankAccountHolder: string;
  holderIdType: "RUC" | "CEDULA" | null;
  holderIdNumber: string | null;
};
export type AdminPaymentPayeeDTO = { id: string; name: string; bankAccounts: PayeeBankAccountDTO[] };

const ACCOUNT_TYPES = ["Ahorro", "Corriente"];
const emptyAccountForm = {
  bankName: "", bankAccountType: "", bankAccountNumber: "", bankAccountHolder: "",
  holderIdType: "" as "" | "RUC" | "CEDULA", holderIdNumber: "",
};

function QuickPick({ options, value, onChange }: { options: { value: string; label: string }[]; value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex gap-1.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          className={`flex-1 rounded border py-1.5 text-[12px] font-semibold cursor-pointer ${value === o.value ? "border-teal bg-teal/10 text-teal" : "border-rule text-steel"}`}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// Catálogo reutilizable de "a quién pagar" — mismo espíritu que
// PurchaseSupplierPicker.tsx pero sin ubicación/categoría/contactos, ya que
// acá solo importa el nombre y sus cuentas bancarias (confirmado 2026-08-06,
// AskUserQuestion: catálogo reutilizable, no campo libre por solicitud).
export function AdminPayeePicker({
  payees,
  value,
  onChange,
  isAdmin,
  selectedBankAccountId,
  onSelectBankAccount,
  onPayeeUpdated,
}: {
  payees: AdminPaymentPayeeDTO[];
  value: AdminPaymentPayeeDTO | null;
  onChange: (p: AdminPaymentPayeeDTO | null) => void;
  isAdmin: boolean;
  selectedBankAccountId: string | null;
  onSelectBankAccount: (id: string | null) => void;
  onPayeeUpdated: (p: AdminPaymentPayeeDTO) => void;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [creatingBusy, setCreatingBusy] = useState(false);
  const [err, setErr] = useState("");

  const [addingAccount, setAddingAccount] = useState(false);
  const [accountForm, setAccountForm] = useState(emptyAccountForm);
  const [accountBusy, setAccountBusy] = useState(false);
  const [accountErr, setAccountErr] = useState("");

  const results = payees.filter((p) => p.name.toLowerCase().includes(query.trim().toLowerCase()));
  const exactMatch = payees.some((p) => p.name.toLowerCase() === query.trim().toLowerCase());

  async function createPayee() {
    if (!query.trim()) return;
    setCreatingBusy(true);
    setErr("");
    const res = await fetch("/api/admin-payment-payees", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: query.trim() }),
    });
    setCreatingBusy(false);
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      setErr(data?.error ?? "No se pudo crear.");
      return;
    }
    const payee: AdminPaymentPayeeDTO = { ...data, bankAccounts: data.bankAccounts ?? [] };
    onPayeeUpdated(payee);
    onChange(payee);
    setOpen(false);
  }

  async function addBankAccount() {
    if (!value) return;
    if (!accountForm.bankName.trim() || !accountForm.bankAccountType.trim() || !accountForm.bankAccountNumber.trim() || !accountForm.bankAccountHolder.trim() || !accountForm.holderIdType || !accountForm.holderIdNumber.trim()) {
      setAccountErr("Completa todos los campos.");
      return;
    }
    setAccountBusy(true);
    setAccountErr("");
    const res = await fetch(`/api/admin-payment-payees/${value.id}/bank-accounts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(accountForm),
    });
    setAccountBusy(false);
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      setAccountErr(data?.error ?? "No se pudo guardar la cuenta.");
      return;
    }
    const updated = { ...value, bankAccounts: [...(value.bankAccounts ?? []), data] };
    onPayeeUpdated(updated);
    onChange(updated);
    onSelectBankAccount(data.id);
    setAddingAccount(false);
    setAccountForm(emptyAccountForm);
  }

  async function deleteBankAccount(accountId: string) {
    if (!value) return;
    if (!confirm("¿Eliminar esta cuenta bancaria? Esta acción no se puede deshacer.")) return;
    const res = await fetch(`/api/admin-payment-payees/${value.id}/bank-accounts/${accountId}`, { method: "DELETE" });
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      alert(data?.error ?? "No se pudo eliminar.");
      return;
    }
    const updated = { ...value, bankAccounts: (value.bankAccounts ?? []).filter((a) => a.id !== accountId) };
    onPayeeUpdated(updated);
    onChange(updated);
    if (selectedBankAccountId === accountId) onSelectBankAccount(null);
  }

  if (value) {
    return (
      <div className="bg-cloud border border-rule rounded-md p-3">
        <div className="flex items-center justify-between mb-2.5">
          <span className="text-[13.5px] font-semibold">{value.name}</span>
          <button type="button" className="text-[11.5px] text-blue font-semibold cursor-pointer" onClick={() => { onChange(null); onSelectBankAccount(null); }}>
            Cambiar
          </button>
        </div>

        <div className="flex flex-col gap-1.5 mb-2.5">
          {(value.bankAccounts ?? []).length === 0 && <div className="text-[11.5px] text-steel">Sin cuentas bancarias registradas.</div>}
          {(value.bankAccounts ?? []).map((acc) => {
            const isSelected = selectedBankAccountId === acc.id;
            return (
              <div
                key={acc.id}
                onClick={() => onSelectBankAccount(acc.id)}
                className={`flex items-center gap-2 rounded border px-2.5 py-2 cursor-pointer ${isSelected ? "border-teal bg-teal/10" : "border-rule bg-surface2"}`}
              >
                <input type="radio" readOnly checked={isSelected} className="shrink-0 w-auto" />
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-2.5 gap-y-0.5 flex-1 min-w-0 text-[11.5px]">
                  <div><span className="text-steel">Banco: </span><span className="font-semibold break-words">{acc.bankName}</span></div>
                  <div><span className="text-steel">Tipo: </span><span className="font-semibold break-words">{acc.bankAccountType}</span></div>
                  {acc.holderIdType && (
                    <div><span className="text-steel">{acc.holderIdType === "RUC" ? "RUC" : "CI"}: </span><span className="font-semibold break-all">{acc.holderIdNumber}</span></div>
                  )}
                  <div><span className="text-steel">Titular: </span><span className="font-semibold break-words">{acc.bankAccountHolder}</span></div>
                  <div><span className="text-steel">N°: </span><span className="font-semibold break-all">{acc.bankAccountNumber}</span></div>
                </div>
                {isAdmin && (
                  <button
                    type="button"
                    title="Eliminar cuenta (solo administrador)"
                    className="text-steel hover:text-red cursor-pointer shrink-0"
                    onClick={(e) => { e.stopPropagation(); deleteBankAccount(acc.id); }}
                  >
                    <Trash2 size={13} />
                  </button>
                )}
              </div>
            );
          })}
        </div>

        {addingAccount ? (
          <div className="bg-surface2 border border-rule rounded-md p-2.5">
            <div className="grid grid-cols-2 gap-2 mb-2">
              <input className="rounded border border-rule px-2 py-1.5 text-[12px]" placeholder="Banco" value={accountForm.bankName} onChange={(e) => setAccountForm((f) => ({ ...f, bankName: e.target.value }))} />
              <input className="rounded border border-rule px-2 py-1.5 text-[12px]" placeholder="N° de cuenta" value={accountForm.bankAccountNumber} onChange={(e) => setAccountForm((f) => ({ ...f, bankAccountNumber: e.target.value }))} />
            </div>
            <div className="mb-2">
              <QuickPick options={ACCOUNT_TYPES.map((t) => ({ value: t, label: t }))} value={accountForm.bankAccountType} onChange={(v) => setAccountForm((f) => ({ ...f, bankAccountType: v }))} />
            </div>
            <input className="w-full rounded border border-rule px-2 py-1.5 text-[12px] mb-2" placeholder="Titular de la cuenta" value={accountForm.bankAccountHolder} onChange={(e) => setAccountForm((f) => ({ ...f, bankAccountHolder: e.target.value }))} />
            <div className="mb-2">
              <QuickPick options={[{ value: "RUC", label: "RUC" }, { value: "CEDULA", label: "Cédula" }]} value={accountForm.holderIdType} onChange={(v) => setAccountForm((f) => ({ ...f, holderIdType: v as "RUC" | "CEDULA" }))} />
            </div>
            <input className="w-full rounded border border-rule px-2 py-1.5 text-[12px] mb-2" placeholder={accountForm.holderIdType === "CEDULA" ? "N° de cédula" : "N° de RUC"} value={accountForm.holderIdNumber} onChange={(e) => setAccountForm((f) => ({ ...f, holderIdNumber: e.target.value }))} />
            {accountErr && <div className="text-red text-[11.5px] mb-2">{accountErr}</div>}
            <div className="flex items-center gap-2">
              <button type="button" disabled={accountBusy} className="rounded border border-teal bg-teal px-3 py-1.5 text-[11.5px] font-bold text-navy cursor-pointer disabled:opacity-60" onClick={addBankAccount}>
                Guardar cuenta
              </button>
              <button type="button" className="text-steel text-[11.5px] cursor-pointer" onClick={() => { setAddingAccount(false); setAccountErr(""); }}>
                Cancelar
              </button>
            </div>
          </div>
        ) : (
          <button type="button" className="flex items-center gap-1 text-[11.5px] text-blue font-semibold cursor-pointer" onClick={() => setAddingAccount(true)}>
            <Plus size={12} /> Agregar cuenta bancaria nueva
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="relative">
      <div className="relative">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-steel" />
        <input
          className="w-full rounded border border-rule pl-8.5 pr-3 py-2 text-[13.5px]"
          placeholder="¿A quién se le paga? Escribe o elige uno existente"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => setOpen(true)}
        />
      </div>
      {open && (
        <div className="mt-1.5 bg-surface2 border border-rule rounded-md overflow-hidden max-h-56 overflow-y-auto">
          {results.map((p) => (
            <button
              key={p.id}
              type="button"
              className="w-full flex items-center gap-2.5 px-3 py-2 text-left text-[13px] hover:bg-cloud cursor-pointer border-b border-rule last:border-none"
              onClick={() => {
                onChange(p);
                setOpen(false);
                setQuery("");
                if (p.bankAccounts[0]) onSelectBankAccount(p.bankAccounts[0].id);
              }}
            >
              <CheckCircle2 size={13} className="text-teal shrink-0" />
              {p.name}
            </button>
          ))}
          {query.trim() && !exactMatch && (
            <button
              type="button"
              disabled={creatingBusy}
              className="w-full flex items-center gap-2 px-3 py-2 text-left text-[12.5px] text-blue font-semibold hover:bg-cloud cursor-pointer disabled:opacity-60"
              onClick={createPayee}
            >
              <Plus size={13} /> Registrar &quot;{query.trim()}&quot; como nuevo
            </button>
          )}
        </div>
      )}
      {err && <div className="text-red text-[11.5px] mt-1.5">{err}</div>}
    </div>
  );
}
