"use client";

import { useEffect, useState } from "react";
import { Search, Plus, CheckCircle2 } from "lucide-react";

type LogisticsProviderDTO = { id: string; name: string; phone: string | null };

// Combobox para "A quién debe entregarle bodega" — confirmado 2026-09-14,
// pedido explícito de Marcos: poder elegir un motorizado ya registrado en
// vez de reescribir el nombre cada vez, y que cualquier otro asesor pueda
// reusar el mismo registro más adelante (ver /api/logistics-providers,
// mismo espíritu compartido que Client/ClientMatchPicker). Sigue siendo
// texto libre — un motorizado no registrado, o "el cliente mismo", se
// puede escribir igual que antes sin tener que matricular nada.
export function LogisticsProviderPicker({ value, onChange }: { value: string; onChange: (name: string) => void }) {
  const [providers, setProviders] = useState<LogisticsProviderDTO[]>([]);
  const [open, setOpen] = useState(false);
  const [registering, setRegistering] = useState(false);
  const [newPhone, setNewPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    fetch("/api/logistics-providers")
      .then((r) => (r.ok ? r.json() : []))
      .then(setProviders)
      .catch(() => null);
  }, []);

  const query = value.trim().toLowerCase();
  const filtered = query ? providers.filter((p) => p.name.toLowerCase().includes(query)) : providers;
  const exactMatch = providers.some((p) => p.name.trim().toLowerCase() === query);

  async function registerNew() {
    const name = value.trim();
    if (!name) return;
    setBusy(true);
    setErr("");
    try {
      const res = await fetch("/api/logistics-providers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, phone: newPhone.trim() || undefined }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        if (res.status === 409 && data?.existingProvider) {
          setProviders((prev) => (prev.some((p) => p.id === data.existingProvider.id) ? prev : [...prev, data.existingProvider]));
          onChange(data.existingProvider.name);
          setRegistering(false);
          setOpen(false);
          return;
        }
        setErr(data?.error ?? "No se pudo registrar.");
        return;
      }
      setProviders((prev) => [...prev, data]);
      onChange(data.name);
      setRegistering(false);
      setOpen(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative">
      <div className="relative">
        <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-steel" />
        <input
          type="text"
          className="w-full rounded border border-rule bg-cloud pl-8 pr-2.5 py-1.5 text-[12.5px]"
          value={value}
          onChange={(e) => { onChange(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => { setOpen(false); setRegistering(false); }, 150)}
        />
      </div>
      {open && (
        <div className="mt-1.5 bg-surface2 border border-rule rounded-md overflow-hidden max-h-48 overflow-y-auto absolute z-10 w-full">
          {filtered.map((p) => (
            <button
              key={p.id}
              type="button"
              className="w-full flex items-center gap-2 px-2.5 py-1.5 text-left text-[12px] hover:bg-cloud cursor-pointer border-b border-rule last:border-none"
              onMouseDown={(e) => { e.preventDefault(); onChange(p.name); setOpen(false); }}
            >
              <CheckCircle2 size={12} className="text-teal shrink-0" />
              <span className="truncate">{p.name}</span>
              {p.phone && <span className="shrink-0 text-[10.5px] text-steel">{p.phone}</span>}
            </button>
          ))}
          {filtered.length === 0 && !query && <div className="px-2.5 py-1.5 text-[11.5px] text-steel">Todavía no hay motorizados registrados.</div>}
          {query && !exactMatch && (
            registering ? (
              <div className="px-2.5 py-2 border-t border-rule">
                <input
                  type="tel"
                  className="w-full rounded border border-rule px-2 py-1 text-[11.5px] mb-1.5"
                  placeholder="Celular (opcional)"
                  value={newPhone}
                  onChange={(e) => setNewPhone(e.target.value)}
                  onMouseDown={(e) => e.stopPropagation()}
                />
                {err && <div className="text-red text-[10.5px] mb-1.5">{err}</div>}
                <div className="flex gap-1.5">
                  <button type="button" disabled={busy} className="flex-1 rounded border border-teal bg-teal px-2 py-1 text-[11px] font-bold text-navy cursor-pointer disabled:opacity-60" onMouseDown={(e) => { e.preventDefault(); registerNew(); }}>
                    {busy ? "Guardando…" : "Guardar"}
                  </button>
                  <button type="button" className="text-[11px] text-steel cursor-pointer" onMouseDown={(e) => { e.preventDefault(); setRegistering(false); }}>Cancelar</button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                className="w-full flex items-center gap-2 px-2.5 py-1.5 text-left text-[11.5px] text-blue font-semibold hover:bg-cloud cursor-pointer"
                onMouseDown={(e) => { e.preventDefault(); setRegistering(true); setNewPhone(""); setErr(""); }}
              >
                <Plus size={12} /> Registrar &quot;{value.trim()}&quot; para reusarlo después
              </button>
            )
          )}
        </div>
      )}
    </div>
  );
}
