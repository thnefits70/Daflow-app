"use client";

import { useState } from "react";
import { IconClose, IconLock } from "@/components/pvx/PvxIcons";

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
    <form onSubmit={submit} className="p-6 sm:p-9">
      <div className="flex items-start justify-between gap-3">
        <div>
          <span className="inline-grid h-11 w-11 place-items-center rounded-2xl bg-[#F95B02] text-white"><IconLock className="w-5 h-5" /></span>
          <h2 className="pvx-heading text-[28px] mt-4">Mira los datos completos de cada producto</h2>
        </div>
        <button type="button" onClick={onClose} aria-label="Cerrar" className="pvx-press grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[#F4F4F2] text-[#111214] hover:bg-[#E9E9E6] cursor-pointer">
          <IconClose className="w-5 h-5" />
        </button>
      </div>
      <p className="text-[15px] leading-relaxed text-[#4A4F58] mt-3">
        Precio al que se vende, cuánto ganas, en qué ciudades se vende más y los combos que funcionan. Es gratis: solo te pedimos tu nombre y tu WhatsApp.
      </p>

      <label className="block mt-5 text-[13.5px] font-bold">Tu nombre</label>
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        autoComplete="name"
        required
        maxLength={80}
        className="mt-1.5 w-full rounded-2xl bg-[#F4F4F2] px-4 py-3 text-[16px] outline-none focus:bg-white focus:shadow-[0_0_0_2px_#F95B02]"
        placeholder="Ej. Andrea Morales"
      />
      <label className="block mt-3 text-[13.5px] font-bold">Tu WhatsApp</label>
      <input
        value={whatsapp}
        onChange={(e) => setWhatsapp(e.target.value)}
        autoComplete="tel"
        inputMode="tel"
        required
        maxLength={20}
        className="mt-1.5 w-full rounded-2xl bg-[#F4F4F2] px-4 py-3 text-[16px] outline-none focus:bg-white focus:shadow-[0_0_0_2px_#F95B02]"
        placeholder="Ej. 0991234567"
      />
      {/* Campo trampa para robots: las personas no lo ven. */}
      <input value={website} onChange={(e) => setWebsite(e.target.value)} tabIndex={-1} autoComplete="off" aria-hidden="true" className="hidden" />

      <label className="mt-5 flex items-start gap-3 rounded-2xl bg-[#FFF1E8] p-4 cursor-pointer">
        <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-0.5 w-5 h-5 accent-[#F95B02] shrink-0" />
        <span className="text-[13px] leading-snug">
          <b>Quiero recibir gratis por WhatsApp los nuevos productos ganadores desde el primer día</b> que empiezan a venderse, antes que los demás.
          <span className="block text-[11.5px] text-[#4A4F58] mt-1">
            Usaremos lo que buscas en Provedix para enviarte solo productos que te interesen. Puedes pedir que te quitemos de la lista cuando quieras.
          </span>
        </span>
      </label>

      {error && <div className="mt-3 text-[13px] text-[#d33a2c]">{error}</div>}

      <button
        type="submit"
        disabled={busy}
        className="pvx-press mt-6 w-full rounded-full bg-[#F95B02] py-4 text-[16px] font-bold text-white hover:bg-[#DD4F00] disabled:opacity-60 cursor-pointer"
      >
        {busy ? "Abriendo…" : "Ver los datos completos"}
      </button>
    </form>
  );
}
