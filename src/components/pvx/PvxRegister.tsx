"use client";

import { useState } from "react";

// Registro corto (decisión del usuario 2026-10-07/10): nombre + WhatsApp y
// una casilla persuasiva — recibir gratis los nuevos ganadores desde el
// primer día. La casilla es obligatoria (la ley pide el consentimiento).
export function PvxRegister({ onDone, onClose }: { onDone: (name: string) => void; onClose: () => void }) {
  const [name, setName] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [consent, setConsent] = useState(false);
  const [website, setWebsite] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!consent) {
      setError("Marca la casilla para recibir los productos ganadores.");
      return;
    }
    setBusy(true);
    const res = await fetch("/api/pvx/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, whatsapp, consent, website }),
    }).catch(() => null);
    const data = await res?.json().catch(() => null);
    setBusy(false);
    if (!res?.ok) {
      setError(data?.error ?? "No se pudo registrar. Revisa tu internet e intenta de nuevo.");
      return;
    }
    onDone(data?.name ?? name);
  }

  return (
    <form onSubmit={submit} className="p-6 sm:p-7">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[11px] font-bold tracking-[.14em] uppercase text-[#ff5a1f]">Gratis · sin suscripción</div>
          <h2 className="text-[22px] font-bold leading-tight mt-1">Mira los datos completos de cada producto</h2>
        </div>
        <button type="button" onClick={onClose} aria-label="Cerrar" className="text-[22px] leading-none text-[#8a8f98] hover:text-[#16181d] cursor-pointer">
          ×
        </button>
      </div>
      <p className="text-[13.5px] text-[#5b616b] mt-2">
        Precio al que se vende, cuánto ganas, en qué ciudades se vende más y los combos que funcionan. Solo te pedimos tu nombre y tu WhatsApp.
      </p>

      <label className="block mt-5 text-[12.5px] font-semibold">Tu nombre</label>
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        autoComplete="name"
        required
        maxLength={80}
        className="mt-1 w-full rounded-lg border border-[#d9d6cf] bg-white px-3 py-2.5 text-[15px] outline-none focus:border-[#ff5a1f]"
        placeholder="Ej. Andrea Morales"
      />
      <label className="block mt-3 text-[12.5px] font-semibold">Tu WhatsApp</label>
      <input
        value={whatsapp}
        onChange={(e) => setWhatsapp(e.target.value)}
        autoComplete="tel"
        inputMode="tel"
        required
        maxLength={20}
        className="mt-1 w-full rounded-lg border border-[#d9d6cf] bg-white px-3 py-2.5 text-[15px] outline-none focus:border-[#ff5a1f]"
        placeholder="Ej. 0991234567"
      />
      {/* Campo trampa para robots: las personas no lo ven. */}
      <input value={website} onChange={(e) => setWebsite(e.target.value)} tabIndex={-1} autoComplete="off" aria-hidden="true" className="hidden" />

      <label className="mt-4 flex items-start gap-3 rounded-lg border border-[#ffd2bf] bg-[#fff4ee] p-3 cursor-pointer">
        <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-0.5 w-5 h-5 accent-[#ff5a1f] shrink-0" />
        <span className="text-[13px] leading-snug">
          <b>Quiero recibir gratis por WhatsApp los nuevos productos ganadores desde el primer día</b> que empiezan a venderse, antes que los demás.
          <span className="block text-[11.5px] text-[#5b616b] mt-1">
            Usaremos lo que buscas en Provedix para enviarte solo productos que te interesen. Puedes pedir que te quitemos de la lista cuando quieras.
          </span>
        </span>
      </label>

      {error && <div className="mt-3 text-[13px] text-[#d33a2c]">{error}</div>}

      <button
        type="submit"
        disabled={busy}
        className="mt-5 w-full rounded-lg bg-[#ff5a1f] py-3 text-[15px] font-bold text-white hover:bg-[#e84e15] disabled:opacity-60 cursor-pointer"
      >
        {busy ? "Abriendo…" : "Ver los datos completos"}
      </button>
    </form>
  );
}
