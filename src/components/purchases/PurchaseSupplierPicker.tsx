"use client";

import { useEffect, useState } from "react";
import { Search, Plus, CheckCircle2, Trash2, Pencil } from "lucide-react";

export type BankAccountDTO = {
  id: string;
  bankName: string;
  bankAccountType: string;
  bankAccountNumber: string;
  bankAccountHolder: string;
  holderIdType: "RUC" | "CEDULA" | null;
  holderIdNumber: string | null;
};

export type PurchaseSupplierDTO = {
  id: string;
  name: string;
  location: string | null;
  email: string | null;
  bankAccounts: BankAccountDTO[];
  contacts: { label: string; whatsapp: string }[];
};

const ACCOUNT_TYPES = ["Ahorro", "Corriente"];

const emptyForm = {
  name: "", category: "", notes: "", location: "",
  bankName: "", bankAccountType: "", bankAccountNumber: "", bankAccountHolder: "",
  holderIdType: "" as "" | "RUC" | "CEDULA", holderIdNumber: "",
  email: "", contactLabel: "", contactWhatsapp: "",
};
const emptyAccountForm = {
  bankName: "", bankAccountType: "", bankAccountNumber: "", bankAccountHolder: "",
  holderIdType: "" as "" | "RUC" | "CEDULA", holderIdNumber: "",
};

// Botones rápidos reutilizados para tipo de cuenta y RUC/cédula — confirmado
// 2026-08-03: evita escribir siempre lo mismo a mano.
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

// Reutilizado para proveedor (type=SUPPLIER, pide ubicación) y transportista
// (type=CARRIER, sin ubicación) — confirmado 2026-07-30: ambos viven en la
// misma tabla que la sección de Proveedores, así que crear aquí también los
// deja disponibles ahí, nunca dos registros del mismo contacto.
// Confirmado 2026-08-03: un proveedor puede tener varias cuentas bancarias
// (cambia de banco, o pide una cuenta nueva) — cualquiera con acceso a
// solicitar compras puede AGREGAR una cuenta más; solo el administrador
// puede ELIMINAR una ya registrada, con confirmación. El nombre del banco
// se sugiere de lo ya registrado antes en cualquier proveedor, para no
// volver a tipearlo siempre.
export function PurchaseSupplierPicker({
  type,
  value,
  onChange,
  label,
  isAdmin = false,
  selectedBankAccountId,
  onSelectBankAccount,
}: {
  type: "SUPPLIER" | "CARRIER";
  value: PurchaseSupplierDTO | null;
  onChange: (s: PurchaseSupplierDTO | null) => void;
  label: string;
  isAdmin?: boolean;
  selectedBankAccountId?: string | null;
  onSelectBankAccount?: (id: string | null) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PurchaseSupplierDTO[]>([]);
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [bankNames, setBankNames] = useState<string[]>([]);

  const [addingAccount, setAddingAccount] = useState(false);
  const [accountForm, setAccountForm] = useState(emptyAccountForm);
  const [accountBusy, setAccountBusy] = useState(false);
  const [accountErr, setAccountErr] = useState("");

  const [editingEmail, setEditingEmail] = useState(false);
  const [emailDraft, setEmailDraft] = useState("");
  const [emailBusy, setEmailBusy] = useState(false);
  const [emailErr, setEmailErr] = useState("");

  useEffect(() => {
    fetch("/api/purchase-suppliers/bank-names")
      .then((r) => (r.ok ? r.json() : []))
      .then(setBankNames)
      .catch(() => null);
  }, []);

  useEffect(() => {
    if (value || creating) return;
    const t = setTimeout(() => {
      fetch(`/api/purchase-suppliers?type=${type}&q=${encodeURIComponent(query.trim())}`)
        .then((r) => (r.ok ? r.json() : []))
        .then(setResults)
        .catch(() => null);
    }, 200);
    return () => clearTimeout(t);
  }, [query, type, value, creating]);

  async function save() {
    if (!form.name.trim() || !form.notes.trim() || !form.bankName.trim() || !form.bankAccountType.trim() || !form.bankAccountNumber.trim() || !form.bankAccountHolder.trim() || !form.holderIdType || !form.holderIdNumber.trim() || !form.contactLabel.trim() || !form.contactWhatsapp.trim()) {
      setErr("Completa todos los campos obligatorios.");
      return;
    }
    if (type === "SUPPLIER" && !form.location.trim()) {
      setErr("Falta la ubicación del proveedor.");
      return;
    }
    setBusy(true);
    setErr("");
    const res = await fetch("/api/purchase-suppliers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type, ...form }),
    });
    setBusy(false);
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      setErr(data?.error ?? "No se pudo guardar.");
      return;
    }
    setCreating(false);
    const supplier: PurchaseSupplierDTO = { ...data, bankAccounts: data.bankAccounts ?? [], contacts: data.contacts ?? [] };
    onChange(supplier);
    if (supplier.bankAccounts[0]) onSelectBankAccount?.(supplier.bankAccounts[0].id);
  }

  async function addBankAccount() {
    if (!value) return;
    if (!accountForm.bankName.trim() || !accountForm.bankAccountType.trim() || !accountForm.bankAccountNumber.trim() || !accountForm.bankAccountHolder.trim() || !accountForm.holderIdType || !accountForm.holderIdNumber.trim()) {
      setAccountErr("Completa todos los campos.");
      return;
    }
    setAccountBusy(true);
    setAccountErr("");
    const res = await fetch(`/api/purchase-suppliers/${value.id}/bank-accounts`, {
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
    onChange({ ...value, bankAccounts: [...(value.bankAccounts ?? []), data] });
    onSelectBankAccount?.(data.id);
    setAddingAccount(false);
    setAccountForm(emptyAccountForm);
  }

  async function deleteBankAccount(accountId: string) {
    if (!value) return;
    if (!confirm("¿Eliminar esta cuenta bancaria? Esta acción no se puede deshacer.")) return;
    const res = await fetch(`/api/purchase-suppliers/${value.id}/bank-accounts/${accountId}`, { method: "DELETE" });
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      alert(data?.error ?? "No se pudo eliminar.");
      return;
    }
    onChange({ ...value, bankAccounts: (value.bankAccounts ?? []).filter((a) => a.id !== accountId) });
    if (selectedBankAccountId === accountId) onSelectBankAccount?.(null);
  }

  async function saveEmail() {
    if (!value) return;
    setEmailBusy(true);
    setEmailErr("");
    const res = await fetch(`/api/purchase-suppliers/${value.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: emailDraft.trim() }),
    });
    setEmailBusy(false);
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      setEmailErr(data?.error ?? "No se pudo guardar el correo.");
      return;
    }
    onChange({ ...value, email: data.email ?? null });
    setEditingEmail(false);
  }

  if (value) {
    return (
      <div className="bg-cloud border border-rule rounded-md p-3">
        <div className="flex items-center justify-between mb-2.5">
          <span className="text-[13.5px] font-semibold">{value.name}</span>
          <button type="button" className="text-[11.5px] text-blue font-semibold cursor-pointer" onClick={() => onChange(null)}>
            Cambiar
          </button>
        </div>

        <div className="flex flex-col gap-1.5 mb-2.5">
          {(value.bankAccounts ?? []).length === 0 && <div className="text-[11.5px] text-steel">Sin cuentas bancarias registradas.</div>}
          {(value.bankAccounts ?? []).map((acc) => {
            const selectable = !!onSelectBankAccount;
            const isSelected = selectedBankAccountId === acc.id;
            return (
              <div
                key={acc.id}
                onClick={() => onSelectBankAccount?.(acc.id)}
                className={`flex items-center gap-2 rounded border px-2.5 py-2 ${selectable ? "cursor-pointer" : ""} ${isSelected ? "border-teal bg-teal/10" : "border-rule bg-surface2"}`}
              >
                {selectable && <input type="radio" readOnly checked={isSelected} className="shrink-0 w-auto" />}
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-2.5 gap-y-0.5 flex-1 min-w-0 text-[11.5px]">
                  <div><span className="text-steel">Banco: </span><span className="font-semibold break-words">{acc.bankName}</span></div>
                  <div><span className="text-steel">Tipo: </span><span className="font-semibold break-words">{acc.bankAccountType}</span></div>
                  <div><span className="text-steel">N°: </span><span className="font-semibold break-all">{acc.bankAccountNumber}</span></div>
                  <div><span className="text-steel">Titular: </span><span className="font-semibold break-words">{acc.bankAccountHolder}</span></div>
                  {acc.holderIdType && (
                    <div><span className="text-steel">{acc.holderIdType === "RUC" ? "RUC" : "CI"}: </span><span className="font-semibold break-all">{acc.holderIdNumber}</span></div>
                  )}
                </div>
                {isAdmin && (
                  <button
                    type="button"
                    title="Eliminar cuenta (solo administrador)"
                    className="text-steel hover:text-red cursor-pointer shrink-0"
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteBankAccount(acc.id);
                    }}
                  >
                    <Trash2 size={13} />
                  </button>
                )}
              </div>
            );
          })}
        </div>

        {addingAccount ? (
          <div className="bg-surface2 border border-rule rounded-md p-2.5 mb-2.5">
            <div className="grid grid-cols-2 gap-2 mb-2">
              <input list={`daflow-bank-names-${type}`} className="rounded border border-rule px-2 py-1.5 text-[12px]" placeholder="Banco" value={accountForm.bankName} onChange={(e) => setAccountForm((f) => ({ ...f, bankName: e.target.value }))} />
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
          <button type="button" className="flex items-center gap-1 text-[11.5px] text-blue font-semibold cursor-pointer mb-2.5" onClick={() => setAddingAccount(true)}>
            <Plus size={12} /> Agregar cuenta bancaria nueva
          </button>
        )}

        {type === "SUPPLIER" && (
          <div className="pt-2.5 border-t border-rule">
            {editingEmail ? (
              <div>
                <input
                  className="w-full rounded border border-rule px-2 py-1.5 text-[12px] mb-2"
                  placeholder="correo@proveedor.com"
                  value={emailDraft}
                  onChange={(e) => setEmailDraft(e.target.value)}
                />
                {emailErr && <div className="text-red text-[11.5px] mb-2">{emailErr}</div>}
                <div className="flex items-center gap-2">
                  <button type="button" disabled={emailBusy} className="rounded border border-teal bg-teal px-3 py-1.5 text-[11.5px] font-bold text-navy cursor-pointer disabled:opacity-60" onClick={saveEmail}>
                    Guardar correo
                  </button>
                  <button type="button" className="text-steel text-[11.5px] cursor-pointer" onClick={() => setEditingEmail(false)}>
                    Cancelar
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-between text-[11.5px]">
                <div className="text-steel">
                  Correo: <span className="font-semibold text-ink">{value.email ?? "—"}</span>
                </div>
                <button
                  type="button"
                  className="flex items-center gap-1 text-blue font-semibold cursor-pointer"
                  onClick={() => { setEmailDraft(value.email ?? ""); setEditingEmail(true); setEmailErr(""); }}
                >
                  <Pencil size={11} /> {value.email ? "Editar" : "Agregar correo"}
                </button>
              </div>
            )}
          </div>
        )}

        <datalist id={`daflow-bank-names-${type}`}>
          {bankNames.map((n) => <option key={n} value={n} />)}
        </datalist>
      </div>
    );
  }

  if (creating) {
    return (
      <div className="bg-surface2 border border-rule rounded-md p-3.5">
        <div className="grid grid-cols-2 gap-2.5 mb-2.5">
          <div>
            <label className="block mb-1 text-[10px] font-semibold uppercase tracking-wide text-steel">Nombre</label>
            <input className="w-full rounded border border-rule px-2.5 py-2 text-[13px]" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
          </div>
          {type === "SUPPLIER" && (
            <div>
              <label className="block mb-1 text-[10px] font-semibold uppercase tracking-wide text-steel">Ubicación</label>
              <input className="w-full rounded border border-rule px-2.5 py-2 text-[13px]" value={form.location} onChange={(e) => setForm((f) => ({ ...f, location: e.target.value }))} />
            </div>
          )}
        </div>
        <div className="grid grid-cols-2 gap-2.5 mb-2.5">
          <div>
            <label className="block mb-1 text-[10px] font-semibold uppercase tracking-wide text-steel">
              Qué {type === "SUPPLIER" ? "provee" : "transporta"} <span className="text-steel-dim">(opcional)</span>
            </label>
            <input className="w-full rounded border border-rule px-2.5 py-2 text-[13px]" value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))} />
          </div>
        </div>
        <div className="mb-2.5">
          <label className="block mb-1 text-[10px] font-semibold uppercase tracking-wide text-steel">Descripción</label>
          <textarea
            rows={2}
            className="w-full rounded border border-rule px-2.5 py-2 text-[13px]"
            value={form.notes}
            onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
            placeholder={type === "SUPPLIER" ? "Ej. Ropa y juguetes, artículos escolares, bisutería…" : "Ej. Entregas dentro de Guayaquil, moto propia…"}
          />
          <div className="text-[10.5px] text-steel mt-1">
            Esta información también aparece en la sección de Proveedores — mientras más detalle, más fácil encontrarlo ahí.
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2.5 mb-2.5">
          <div>
            <label className="block mb-1 text-[10px] font-semibold uppercase tracking-wide text-steel">Banco</label>
            <input list={`daflow-bank-names-${type}`} className="w-full rounded border border-rule px-2.5 py-2 text-[13px]" value={form.bankName} onChange={(e) => setForm((f) => ({ ...f, bankName: e.target.value }))} />
          </div>
          <div>
            <label className="block mb-1 text-[10px] font-semibold uppercase tracking-wide text-steel">N° de cuenta</label>
            <input className="w-full rounded border border-rule px-2.5 py-2 text-[13px]" value={form.bankAccountNumber} onChange={(e) => setForm((f) => ({ ...f, bankAccountNumber: e.target.value }))} />
          </div>
        </div>
        <div className="mb-2.5">
          <label className="block mb-1 text-[10px] font-semibold uppercase tracking-wide text-steel">Tipo de cuenta</label>
          <QuickPick options={ACCOUNT_TYPES.map((t) => ({ value: t, label: t }))} value={form.bankAccountType} onChange={(v) => setForm((f) => ({ ...f, bankAccountType: v }))} />
        </div>
        <div className="mb-2.5">
          <label className="block mb-1 text-[10px] font-semibold uppercase tracking-wide text-steel">Titular de la cuenta</label>
          <input className="w-full rounded border border-rule px-2.5 py-2 text-[13px]" value={form.bankAccountHolder} onChange={(e) => setForm((f) => ({ ...f, bankAccountHolder: e.target.value }))} />
        </div>
        <div className="grid grid-cols-2 gap-2.5 mb-2.5">
          <div>
            <label className="block mb-1 text-[10px] font-semibold uppercase tracking-wide text-steel">Identificación del titular</label>
            <QuickPick options={[{ value: "RUC", label: "RUC" }, { value: "CEDULA", label: "Cédula" }]} value={form.holderIdType} onChange={(v) => setForm((f) => ({ ...f, holderIdType: v as "RUC" | "CEDULA" }))} />
          </div>
          <div>
            <label className="block mb-1 text-[10px] font-semibold uppercase tracking-wide text-steel">{form.holderIdType === "CEDULA" ? "N° de cédula" : "N° de RUC"}</label>
            <input className="w-full rounded border border-rule px-2.5 py-2 text-[13px]" value={form.holderIdNumber} onChange={(e) => setForm((f) => ({ ...f, holderIdNumber: e.target.value }))} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2.5 mb-2.5">
          <div>
            <label className="block mb-1 text-[10px] font-semibold uppercase tracking-wide text-steel">Asesor/contacto</label>
            <input className="w-full rounded border border-rule px-2.5 py-2 text-[13px]" value={form.contactLabel} onChange={(e) => setForm((f) => ({ ...f, contactLabel: e.target.value }))} placeholder="Nombre" />
          </div>
          <div>
            <label className="block mb-1 text-[10px] font-semibold uppercase tracking-wide text-steel">Celular / WhatsApp</label>
            <input className="w-full rounded border border-rule px-2.5 py-2 text-[13px]" value={form.contactWhatsapp} onChange={(e) => setForm((f) => ({ ...f, contactWhatsapp: e.target.value }))} />
          </div>
        </div>
        {type === "SUPPLIER" && (
          <div className="mb-3">
            <label className="block mb-1 text-[10px] font-semibold uppercase tracking-wide text-steel">Correo electrónico <span className="text-steel-dim">(opcional)</span></label>
            <input className="w-full rounded border border-rule px-2.5 py-2 text-[13px]" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} placeholder="Déjalo vacío si no tiene" />
          </div>
        )}
        <div className="text-[11px] text-steel mb-3">
          ¿Verificaste que todos los detalles están escritos correctamente? Una vez guardado no se puede eliminar sin autorización del administrador.
        </div>
        {err && <div className="text-red text-[12px] mb-2.5">{err}</div>}
        <div className="flex items-center gap-2.5">
          <button type="button" disabled={busy} className="rounded border border-teal bg-teal px-3.5 py-2 text-[12.5px] font-bold text-navy cursor-pointer disabled:opacity-60" onClick={save}>
            Guardar
          </button>
          <button type="button" className="text-steel text-[12.5px] cursor-pointer" onClick={() => setCreating(false)}>
            Cancelar
          </button>
        </div>
        <datalist id={`daflow-bank-names-${type}`}>
          {bankNames.map((n) => <option key={n} value={n} />)}
        </datalist>
      </div>
    );
  }

  return (
    <div className="relative">
      <div className="relative">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-steel" />
        <input
          className="w-full rounded border border-rule pl-8.5 pr-3 py-2 text-[13.5px]"
          placeholder={label}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => setOpen(true)}
        />
      </div>
      {open && (
        <div className="mt-1.5 bg-surface2 border border-rule rounded-md overflow-hidden max-h-56 overflow-y-auto">
          {results.map((s) => (
            <button
              key={s.id}
              type="button"
              className="w-full flex items-center gap-2.5 px-3 py-2 text-left text-[13px] hover:bg-cloud cursor-pointer border-b border-rule last:border-none"
              onClick={() => {
                onChange(s);
                setOpen(false);
                if (s.bankAccounts[0]) onSelectBankAccount?.(s.bankAccounts[0].id);
              }}
            >
              <CheckCircle2 size={13} className="text-teal shrink-0" />
              {s.name}
            </button>
          ))}
          <button
            type="button"
            className="w-full flex items-center gap-2 px-3 py-2 text-left text-[12.5px] text-blue font-semibold hover:bg-cloud cursor-pointer"
            onClick={() => {
              setForm({ ...emptyForm, name: query });
              setCreating(true);
              setErr("");
            }}
          >
            <Plus size={13} /> Registrar {type === "SUPPLIER" ? "proveedor" : "transportista"} nuevo
          </button>
        </div>
      )}
    </div>
  );
}
