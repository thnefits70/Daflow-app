"use client";

import { useEffect, useState } from "react";
import { Search, Plus, CheckCircle2 } from "lucide-react";

export type ClientDTO = {
  id: string;
  name: string;
  idType: "RUC" | "CEDULA";
  idNumber: string;
  phone: string;
  email: string | null;
  address: string;
  country: string | null;
  city: string | null;
};

// Lista simple para el buscador de país — sin API externa. Ecuador primero
// porque es donde vive la mayoría de los clientes; el resto es texto libre
// si no aparece en la lista.
const COUNTRIES = [
  "Ecuador",
  "Colombia",
  "Perú",
  "México",
  "Chile",
  "Argentina",
  "Estados Unidos",
  "España",
  "Panamá",
  "Venezuela",
  "Bolivia",
  "Costa Rica",
  "Guatemala",
  "República Dominicana",
];

// Mismo patrón que PurchaseCatalogPicker (buscar existente o matricular uno
// nuevo), simplificado: sin fotos ni chequeo por IA — un RUC/cédula es un
// match exacto o no lo es, no hay variaciones de tipeo que revisar.
export function ClientMatchPicker({ value, onChange }: { value: ClientDTO | null; onChange: (client: ClientDTO | null) => void }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ClientDTO[]>([]);
  const [open, setOpen] = useState(false);

  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newIdType, setNewIdType] = useState<"RUC" | "CEDULA">("CEDULA");
  const [newIdNumber, setNewIdNumber] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newAddress, setNewAddress] = useState("");
  const [newCountry, setNewCountry] = useState("");
  const [newCity, setNewCity] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (value) return;
    let active = true;
    fetch("/api/clients")
      .then((r) => (r.ok ? r.json() : []))
      .then((data: ClientDTO[]) => {
        if (active) setResults(data);
      })
      .catch(() => null);
    return () => {
      active = false;
    };
  }, [value]);

  const filtered = query.trim()
    ? results.filter((c) => {
        const q = query.trim().toLowerCase();
        return c.name.toLowerCase().includes(q) || c.idNumber.toLowerCase().includes(q) || c.phone.toLowerCase().includes(q);
      })
    : results;

  function startCreate() {
    setCreating(true);
    setNewName(query);
    setNewIdType("CEDULA");
    setNewIdNumber("");
    setNewPhone("");
    setNewEmail("");
    setNewAddress("");
    setNewCountry("");
    setNewCity("");
    setErr("");
  }

  function resetCreateForm() {
    setCreating(false);
    setErr("");
  }

  async function saveNew() {
    if (!newName.trim() || !newIdNumber.trim() || !newPhone.trim() || !newAddress.trim()) {
      setErr("Completa nombre, RUC o cédula, celular y dirección referencial.");
      return;
    }
    if (newEmail.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail.trim())) {
      setErr("El correo no tiene un formato válido.");
      return;
    }
    setBusy(true);
    setErr("");
    let res: Response;
    try {
      res = await fetch("/api/clients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newName.trim(),
          idType: newIdType,
          idNumber: newIdNumber.trim(),
          phone: newPhone.trim(),
          email: newEmail.trim() || undefined,
          address: newAddress.trim(),
          country: newCountry.trim() || undefined,
          city: newCity.trim() || undefined,
        }),
      });
    } catch {
      setBusy(false);
      setErr("No se pudo guardar — revisa tu conexión e intenta de nuevo.");
      return;
    }
    setBusy(false);
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      // Ya existe ese RUC/cédula — el servidor devuelve el cliente existente, se selecciona directo en vez de bloquear.
      if (res.status === 409 && data?.existingClient) {
        onChange(data.existingClient);
        setCreating(false);
        setOpen(false);
        return;
      }
      setErr(data?.error ?? "No se pudo registrar el cliente.");
      return;
    }
    setCreating(false);
    onChange(data);
    setOpen(false);
  }

  if (value) {
    return (
      <div className="flex items-center gap-2.5 bg-cloud border border-rule rounded-md px-3 py-2.5">
        <CheckCircle2 size={15} className="text-teal shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="text-[13.5px] font-semibold truncate">{value.name}</div>
          <div className="text-[11px] text-steel">{value.idType === "RUC" ? "RUC" : "Cédula"}: {value.idNumber} · Cel: {value.phone}</div>
          {value.email && <div className="text-[11px] text-steel">Correo: {value.email}</div>}
          {(value.city || value.country) && (
            <div className="text-[11px] text-steel">{[value.city, value.country].filter(Boolean).join(", ")}</div>
          )}
        </div>
        <button type="button" className="text-[11.5px] text-blue font-semibold cursor-pointer shrink-0" onClick={() => onChange(null)}>
          Cambiar
        </button>
      </div>
    );
  }

  if (creating) {
    return (
      <div className="bg-surface2 border border-rule rounded-md p-3.5">
        <label className="block mb-1 text-[10px] font-semibold uppercase tracking-wide text-steel">Nombre del cliente</label>
        <input className="w-full rounded border border-rule px-2.5 py-2 text-[13.5px] mb-3" value={newName} onChange={(e) => setNewName(e.target.value)} />

        <label className="block mb-1 text-[10px] font-semibold uppercase tracking-wide text-steel">Tipo de identificación</label>
        <div className="flex gap-2 mb-3">
          <button
            type="button"
            className={`flex-1 rounded border px-2.5 py-1.5 text-[12.5px] font-semibold cursor-pointer ${newIdType === "CEDULA" ? "border-teal bg-teal text-navy" : "border-rule text-steel"}`}
            onClick={() => setNewIdType("CEDULA")}
          >
            Cédula
          </button>
          <button
            type="button"
            className={`flex-1 rounded border px-2.5 py-1.5 text-[12.5px] font-semibold cursor-pointer ${newIdType === "RUC" ? "border-teal bg-teal text-navy" : "border-rule text-steel"}`}
            onClick={() => setNewIdType("RUC")}
          >
            RUC
          </button>
        </div>

        <label className="block mb-1 text-[10px] font-semibold uppercase tracking-wide text-steel">Número de {newIdType === "RUC" ? "RUC" : "cédula"}</label>
        <input className="w-full rounded border border-rule px-2.5 py-2 text-[13.5px] mb-3" value={newIdNumber} onChange={(e) => setNewIdNumber(e.target.value)} />

        <label className="block mb-1 text-[10px] font-semibold uppercase tracking-wide text-steel">Celular</label>
        <input type="tel" className="w-full rounded border border-rule px-2.5 py-2 text-[13.5px] mb-3" value={newPhone} onChange={(e) => setNewPhone(e.target.value)} />

        <label className="block mb-1 text-[10px] font-semibold uppercase tracking-wide text-steel">Correo (opcional)</label>
        <input type="email" className="w-full rounded border border-rule px-2.5 py-2 text-[13.5px] mb-3" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} placeholder="cliente@correo.com" />

        <label className="block mb-1 text-[10px] font-semibold uppercase tracking-wide text-steel">Dirección referencial</label>
        <input className="w-full rounded border border-rule px-2.5 py-2 text-[13.5px] mb-3" value={newAddress} onChange={(e) => setNewAddress(e.target.value)} placeholder="Ej. Sector, calle, punto de referencia" />

        <div className="flex gap-2.5 mb-3">
          <div className="flex-1">
            <label className="block mb-1 text-[10px] font-semibold uppercase tracking-wide text-steel">País (opcional)</label>
            <input
              className="w-full rounded border border-rule px-2.5 py-2 text-[13.5px]"
              list="client-country-options"
              value={newCountry}
              onChange={(e) => setNewCountry(e.target.value)}
              placeholder="Empieza a escribir…"
            />
            <datalist id="client-country-options">
              {COUNTRIES.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </div>
          <div className="flex-1">
            <label className="block mb-1 text-[10px] font-semibold uppercase tracking-wide text-steel">Ciudad (opcional)</label>
            <input className="w-full rounded border border-rule px-2.5 py-2 text-[13.5px]" value={newCity} onChange={(e) => setNewCity(e.target.value)} />
          </div>
        </div>
        <div className="text-[11px] text-steel mb-3">Solo para saber dónde vive el cliente — no cambia a dónde se despacha el pedido.</div>

        {err && <div className="text-red text-[12px] mb-2.5">{err}</div>}
        <div className="flex items-center gap-2.5">
          <button
            type="button"
            disabled={busy}
            className="rounded border border-teal bg-teal px-3.5 py-2 text-[12.5px] font-bold text-navy cursor-pointer disabled:opacity-60"
            onClick={saveNew}
          >
            {busy ? "Guardando…" : "Matricular cliente"}
          </button>
          <button type="button" className="text-steel text-[12.5px] cursor-pointer" onClick={resetCreateForm}>
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
          placeholder="Buscar cliente por nombre, cédula/RUC o celular"
          value={query}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
        />
      </div>
      {open && (
        <div className="mt-1.5 bg-surface2 border border-rule rounded-md overflow-hidden max-h-56 overflow-y-auto">
          {filtered.map((c) => (
            <button
              key={c.id}
              type="button"
              className="w-full flex items-center gap-2.5 px-3 py-2 text-left text-[13px] hover:bg-cloud cursor-pointer border-b border-rule last:border-none"
              onClick={() => { onChange(c); setOpen(false); }}
            >
              <CheckCircle2 size={13} className="text-teal shrink-0" />
              <span className="truncate">{c.name}</span>
              <span className="shrink-0 text-[11px] text-steel">{c.idNumber}</span>
            </button>
          ))}
          <button
            type="button"
            className="w-full flex items-center gap-2 px-3 py-2 text-left text-[12.5px] text-blue font-semibold hover:bg-cloud cursor-pointer"
            onClick={startCreate}
          >
            <Plus size={13} /> Matricular {query.trim() ? `"${query.trim()}"` : "cliente nuevo"}
          </button>
        </div>
      )}
    </div>
  );
}
