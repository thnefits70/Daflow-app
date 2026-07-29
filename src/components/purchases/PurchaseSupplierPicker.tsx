"use client";

import { useEffect, useState } from "react";
import { Search, Plus, CheckCircle2 } from "lucide-react";

export type PurchaseSupplierDTO = {
  id: string;
  name: string;
  location: string | null;
  bankName: string | null;
  bankAccountType: string | null;
  bankAccountNumber: string | null;
  bankAccountHolder: string | null;
  contacts: { label: string; whatsapp: string }[];
};

const emptyForm = { name: "", location: "", bankName: "", bankAccountType: "", bankAccountNumber: "", bankAccountHolder: "", email: "", contactLabel: "", contactWhatsapp: "" };

// Reutilizado para proveedor (type=SUPPLIER, pide ubicación) y transportista
// (type=CARRIER, sin ubicación) — confirmado 2026-07-30: ambos viven en la
// misma tabla que la sección de Proveedores, así que crear aquí también los
// deja disponibles ahí, nunca dos registros del mismo contacto.
export function PurchaseSupplierPicker({
  type,
  value,
  onChange,
  label,
}: {
  type: "SUPPLIER" | "CARRIER";
  value: PurchaseSupplierDTO | null;
  onChange: (s: PurchaseSupplierDTO | null) => void;
  label: string;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PurchaseSupplierDTO[]>([]);
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

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
    if (!form.name.trim() || !form.bankName.trim() || !form.bankAccountType.trim() || !form.bankAccountNumber.trim() || !form.bankAccountHolder.trim() || !form.contactLabel.trim() || !form.contactWhatsapp.trim()) {
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
    onChange({ ...data, contacts: data.contacts ?? [] });
  }

  if (value) {
    return (
      <div className="bg-cloud border border-rule rounded-md p-3">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[13.5px] font-semibold">{value.name}</span>
          <button type="button" className="text-[11.5px] text-blue font-semibold cursor-pointer" onClick={() => onChange(null)}>
            Cambiar
          </button>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
          <div><div className="text-[9.5px] uppercase text-steel">Banco</div><div className="text-[12.5px] font-semibold break-words">{value.bankName ?? "—"}</div></div>
          <div><div className="text-[9.5px] uppercase text-steel">Tipo de cuenta</div><div className="text-[12.5px] font-semibold break-words">{value.bankAccountType ?? "—"}</div></div>
          <div><div className="text-[9.5px] uppercase text-steel">N° de cuenta</div><div className="text-[12.5px] font-semibold break-words">{value.bankAccountNumber ?? "—"}</div></div>
          <div><div className="text-[9.5px] uppercase text-steel">Titular</div><div className="text-[12.5px] font-semibold break-words">{value.bankAccountHolder ?? "—"}</div></div>
        </div>
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
            <label className="block mb-1 text-[10px] font-semibold uppercase tracking-wide text-steel">Banco</label>
            <input className="w-full rounded border border-rule px-2.5 py-2 text-[13px]" value={form.bankName} onChange={(e) => setForm((f) => ({ ...f, bankName: e.target.value }))} />
          </div>
          <div>
            <label className="block mb-1 text-[10px] font-semibold uppercase tracking-wide text-steel">Tipo de cuenta</label>
            <input className="w-full rounded border border-rule px-2.5 py-2 text-[13px]" value={form.bankAccountType} onChange={(e) => setForm((f) => ({ ...f, bankAccountType: e.target.value }))} placeholder="Corriente / Ahorros" />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2.5 mb-2.5">
          <div>
            <label className="block mb-1 text-[10px] font-semibold uppercase tracking-wide text-steel">N° de cuenta</label>
            <input className="w-full rounded border border-rule px-2.5 py-2 text-[13px]" value={form.bankAccountNumber} onChange={(e) => setForm((f) => ({ ...f, bankAccountNumber: e.target.value }))} />
          </div>
          <div>
            <label className="block mb-1 text-[10px] font-semibold uppercase tracking-wide text-steel">Titular</label>
            <input className="w-full rounded border border-rule px-2.5 py-2 text-[13px]" value={form.bankAccountHolder} onChange={(e) => setForm((f) => ({ ...f, bankAccountHolder: e.target.value }))} />
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
