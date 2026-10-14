"use client";

import { useState } from "react";
import { IconClose, IconLock } from "@/components/pvx/PvxIcons";
import { PHONE_COUNTRIES, checkWhatsapp, phoneCountry } from "@/lib/pvxPhone";

// Registro corto (decisión del usuario 2026-10-07/10): nombre + WhatsApp y
// una casilla persuasiva — recibir gratis los nuevos ganadores desde el
// primer día. La casilla es obligatoria (la ley pide el consentimiento).
export function PvxRegister({ onDone, onClose }: { onDone: (name: string) => void; onClose: () => void }) {
  const [name, setName] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  // Prefijo de país obligatorio (idea de Daniel 2026-10-13). Ecuador por defecto.
  const [country, setCountry] = useState("EC");
  const [phoneTouched, setPhoneTouched] = useState(false);
  const phoneCheck = checkWhatsapp(country, whatsapp);
  const pc = phoneCountry(country)!;
  // Pedido del usuario 2026-10-14: tienda y plataforma obligatorias, correo opcional.
  const [storeName, setStoreName] = useState("");
  const [platform, setPlatform] = useState<"" | "DROPI" | "ROCKET" | "AMBAS">("");
  const [platformEmail, setPlatformEmail] = useState("");
  const [consent, setConsent] = useState(false);
  const [website, setWebsite] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!phoneCheck.ok) {
      // El motivo ya se ve en rojo debajo del número; se lleva el cursor ahí.
      setPhoneTouched(true);
      document.getElementById("pvx-wa")?.focus();
      return;
    }
    if (!platform) {
      setError("Elige dónde vendes: Dropi, Rocket o ambas.");
      return;
    }
    if (!consent) {
      setError("Marca la casilla para recibir los productos ganadores.");
      return;
    }
    setBusy(true);
    const res = await fetch("/api/pvx/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, storeName, platform, platformEmail: platformEmail.trim(), country, whatsapp, consent, website }),
    }).catch(() => null);
    const data = await res?.json().catch(() => null);
    setBusy(false);
    if (!res?.ok) {
      setError(data?.error ?? "No se pudo registrar. Revisa tu internet e intenta de nuevo.");
      return;
    }
    onDone(data?.name ?? name);
  }

  // Todo el registro entra en pantalla sin bajar (pedido 2026-10-14): en
  // computadora va en dos columnas; en celular, compacto en una.
  const input = "mt-1 w-full rounded-xl bg-[#F4F4F2] px-3.5 py-2.5 text-[16px] outline-none focus:bg-white focus:shadow-[0_0_0_2px_#F95B02]";
  const label = "block text-[13px] font-bold";
  const phoneBad = phoneTouched && !phoneCheck.ok && !!whatsapp;
  return (
    <form onSubmit={submit} className="p-5 sm:p-7">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#F95B02] text-white">
            <IconLock className="w-5 h-5" />
          </span>
          <div>
            <h2 className="pvx-heading whitespace-nowrap text-[19px] min-[400px]:text-[22px] sm:text-[26px]">Mira los datos completos</h2>
            <p className="text-[13px] leading-snug text-[#4A4F58] sm:text-[13.5px]">Precio, ganancia, ciudades y combos. Gratis.</p>
          </div>
        </div>
        <button type="button" onClick={onClose} aria-label="Cerrar" className="pvx-press grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[#F4F4F2] text-[#111214] hover:bg-[#E9E9E6] cursor-pointer">
          <IconClose className="w-5 h-5" />
        </button>
      </div>

      <div className="mt-3.5 grid gap-x-3 gap-y-2 sm:mt-4 sm:grid-cols-2 sm:gap-y-2.5">
        <div>
          <label htmlFor="pvx-name" className={label}>
            Tu nombre
          </label>
          <input id="pvx-name" name="name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required maxLength={80} className={input} placeholder="Ej. Andrea Morales…" />
        </div>
        <div>
          <label htmlFor="pvx-store" className={label}>
            Nombre de tu tienda
          </label>
          <input
            id="pvx-store"
            name="store"
            value={storeName}
            onChange={(e) => setStoreName(e.target.value)}
            autoComplete="organization"
            required
            minLength={2}
            maxLength={80}
            className={input}
            placeholder="Ej. Andrea Store…"
          />
        </div>

        <div className="sm:col-span-2">
          <span className={label} id="pvx-platform-label">
            ¿Dónde vendes?
          </span>
          <div role="radiogroup" aria-labelledby="pvx-platform-label" className="mt-1 grid grid-cols-3 gap-2">
            {(
              [
                ["DROPI", "Dropi"],
                ["ROCKET", "Rocket"],
                ["AMBAS", "En ambas"],
              ] as const
            ).map(([v, text]) => (
              <button
                key={v}
                type="button"
                role="radio"
                aria-checked={platform === v}
                onClick={() => setPlatform(v)}
                className={`pvx-press rounded-xl px-2 py-2.5 text-[14.5px] font-bold cursor-pointer ${platform === v ? "bg-[#111214] text-white" : "bg-[#F4F4F2] text-[#111214] hover:bg-[#E9E9E6]"}`}
              >
                {text}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label htmlFor="pvx-wa" className={label}>
            Tu WhatsApp <span className="font-semibold text-[#4A4F58]">(con país)</span>
          </label>
          <div className={`mt-1 flex items-stretch overflow-hidden rounded-xl bg-[#F4F4F2] focus-within:bg-white ${phoneBad ? "shadow-[0_0_0_2px_#d33a2c]" : "focus-within:shadow-[0_0_0_2px_#F95B02]"}`}>
            <label className="relative flex shrink-0 items-center border-r border-[#E9E9E6]">
              <span className="sr-only">País</span>
              <select
                value={country}
                onChange={(e) => setCountry(e.target.value)}
                aria-label="País del WhatsApp"
                className="h-full cursor-pointer appearance-none bg-transparent text-[#111214] py-2.5 pl-3 pr-7 text-[15px] font-bold outline-none"
              >
                {PHONE_COUNTRIES.map((c) => (
                  <option key={c.iso} value={c.iso}>
                    {c.iso} +{c.code}
                  </option>
                ))}
              </select>
              <span className="pointer-events-none absolute right-2.5 text-[10px] text-[#6B717B]">▼</span>
            </label>
            <input
              id="pvx-wa"
              name="whatsapp"
              value={whatsapp}
              onChange={(e) => setWhatsapp(e.target.value)}
              onBlur={() => setPhoneTouched(true)}
              autoComplete="tel-national"
              inputMode="tel"
              required
              maxLength={20}
              className="min-w-0 flex-1 bg-transparent px-3 py-2.5 text-[16px] outline-none"
              placeholder={`${pc.example}…`}
            />
          </div>
          {phoneBad && (
            <p role="alert" className="mt-1 text-[12px] leading-snug text-[#d33a2c]">
              {phoneCheck.error}
            </p>
          )}
        </div>
        <div>
          <label htmlFor="pvx-email" className={label}>
            Correo de {platform === "ROCKET" ? "Rocket" : platform === "AMBAS" ? "Dropi o Rocket" : "Dropi"} <span className="font-semibold text-[#4A4F58]">(opcional)</span>
          </label>
          <input
            id="pvx-email"
            name="email"
            type="email"
            spellCheck={false}
            value={platformEmail}
            onChange={(e) => setPlatformEmail(e.target.value)}
            autoComplete="email"
            inputMode="email"
            maxLength={120}
            className={input}
            placeholder="tucorreo@gmail.com…"
          />
        </div>
      </div>
      {/* Campo trampa para robots: las personas no lo ven. */}
      <input value={website} onChange={(e) => setWebsite(e.target.value)} tabIndex={-1} autoComplete="off" aria-hidden="true" className="hidden" />

      <label className="mt-3 flex items-start gap-3 rounded-xl bg-[#FFF1E8] px-3.5 py-2.5 cursor-pointer sm:mt-3.5 sm:py-3">
        <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-0.5 w-5 h-5 accent-[#F95B02] shrink-0" />
        <span className="text-[13px] leading-snug">
          <b>Quiero recibir gratis por WhatsApp los productos ganadores nuevos, antes que los demás.</b>
          <span className="block text-[11.5px] text-[#4A4F58] mt-0.5">Te enviaremos solo lo que te interese. Puedes darte de baja cuando quieras.</span>
        </span>
      </label>

      {error && (
        <div role="alert" className="mt-2 text-[13px] text-[#d33a2c]">
          {error}
        </div>
      )}

      <button
        type="submit"
        disabled={busy}
        className="pvx-press pvx-shine mt-3 w-full rounded-full bg-[#F95B02] py-3.5 text-[16px] font-bold text-white hover:bg-[#DD4F00] disabled:opacity-60 cursor-pointer"
      >
        {busy ? "Abriendo…" : "Ver los datos completos"}
      </button>
    </form>
  );
}
