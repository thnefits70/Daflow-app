"use client";

import { useEffect, useRef, useState } from "react";
import { PHONE_COUNTRIES, checkWhatsapp, phoneCountry } from "@/lib/pvxPhone";
import { PRIVACY_URL } from "@/lib/pvxFaq";
import { IconArrow } from "@/components/pvx/PvxIcons";
import { cleanPersonName } from "@/lib/pvxName";

// Registro DENTRO del chat de Michelle IA (pedido del usuario 2026-10-17): los
// mismos datos que el formulario (nombre, WhatsApp con país, tienda, dónde
// vende, correo opcional y aceptación), pero uno por uno, como una
// conversación. Mismas medidas de seguridad: va a /api/pvx/register (campo
// trampa para robots, tiempo mínimo de llenado, límites por conexión).

type Platform = "DROPI" | "ROCKET" | "AMBAS";
const PLATFORM_LABEL: Record<Platform, string> = { DROPI: "Dropi", ROCKET: "Rocket", AMBAS: "Las dos" };
const STEPS = ["name", "whatsapp", "store", "platform", "email", "consent"] as const;
type Step = (typeof STEPS)[number];

const nowMs = () => Date.now();

function Bubble({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-3 flex gap-2">
      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[var(--pvx-orange)] text-[12.5px] font-black italic text-white" aria-hidden>
        M
      </span>
      <div className="max-w-[85%] rounded-2xl rounded-tl-md bg-white px-3.5 py-2.5 text-[14.5px] leading-relaxed">{children}</div>
    </div>
  );
}
function Mine({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-3 flex justify-end">
      <div className="max-w-[85%] rounded-2xl rounded-tr-md bg-[var(--pvx-ink)] px-3.5 py-2.5 text-[14.5px] text-white">{children}</div>
    </div>
  );
}

export function PvxChatRegister({ onDone, pending = false }: { onDone: (name: string) => void; pending?: boolean }) {
  const [step, setStep] = useState<Step>("name");
  const [name, setName] = useState("");
  const [country, setCountry] = useState("EC");
  const [whatsapp, setWhatsapp] = useState("");
  const [storeName, setStoreName] = useState("");
  const [platform, setPlatform] = useState<Platform | "">("");
  const [email, setEmail] = useState("");
  const [consent, setConsent] = useState(false);
  const [website, setWebsite] = useState("");
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const startedAt = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    startedAt.current = nowMs();
  }, []);
  useEffect(() => {
    inputRef.current?.focus();
  }, [step]);

  const idx = STEPS.indexOf(step);
  const pc = phoneCountry(country)!;
  const first = name.trim().split(/\s+/)[0] ?? "";

  function next() {
    setError("");
    const v = draft.trim();
    if (step === "name") {
      const n = cleanPersonName(v);
      if (!n.ok) return setError(n.error);
      setName(n.name);
    } else if (step === "whatsapp") {
      const c = checkWhatsapp(country, v);
      if (!c.ok) return setError(c.error);
      setWhatsapp(v);
    } else if (step === "store") {
      if (v.length < 2) return setError("Escribe el nombre de tu tienda.");
      setStoreName(v.replace(/\s+/g, " "));
    } else if (step === "email") {
      if (v && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return setError("Ese correo no es válido. Revísalo o toca Saltar.");
      setEmail(v);
    }
    setDraft("");
    setStep(STEPS[idx + 1]);
  }

  async function submit() {
    setError("");
    if (!consent) return setError("Marca la casilla para continuar.");
    setBusy(true);
    const res = await fetch("/api/pvx/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        storeName,
        platform,
        platformEmail: email,
        country,
        whatsapp,
        consent,
        website,
        fillMs: nowMs() - startedAt.current,
      }),
    }).catch(() => null);
    const data = await res?.json().catch(() => null);
    setBusy(false);
    if (!res?.ok) return setError(data?.error ?? "No se pudo registrar. Revisa tu internet e intenta de nuevo.");
    onDone(data?.name ?? name);
  }

  const input =
    "min-w-0 flex-1 rounded-2xl bg-white px-3.5 py-2.5 text-[16px] outline-none ring-1 ring-[var(--pvx-paper-3)] focus:ring-2 focus:ring-[var(--pvx-orange)]";
  const go =
    "pvx-press grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[var(--pvx-orange)] text-white hover:bg-[var(--pvx-orange-press)] disabled:opacity-40 cursor-pointer";
  const textStep = step === "name" || step === "whatsapp" || step === "store" || step === "email";

  return (
    <div>
      <Bubble>
        {pending
          ? "¡Buena pregunta! 😊 Te la respondo apenas me cuentes un poquito de ti. ¿Cómo te llamas?"
          : "Me encanta ayudarte 😊 Para mostrarte todo, cuéntame un poquito de ti. ¿Cómo te llamas?"}
      </Bubble>
      {idx > 0 && <Mine>{name}</Mine>}
      {idx >= 1 && <Bubble>Mucho gusto, {first} 💛 ¿Cuál es tu WhatsApp?</Bubble>}
      {idx > 1 && (
        <Mine>
          +{pc.code} {whatsapp}
        </Mine>
      )}
      {idx >= 2 && <Bubble>¿Cómo se llama tu tienda?</Bubble>}
      {idx > 2 && <Mine>{storeName}</Mine>}
      {idx >= 3 && <Bubble>¿Dónde vendes?</Bubble>}
      {idx > 3 && platform && <Mine>{PLATFORM_LABEL[platform]}</Mine>}
      {idx >= 4 && <Bubble>¿Me dejas el correo de tu cuenta de {platform === "ROCKET" ? "Rocket" : "Dropi"}? Es opcional.</Bubble>}
      {idx > 4 && <Mine>{email || "Saltar"}</Mine>}
      {idx >= 5 && (
        <Bubble>
          ¡Listo, ya casi! Solo confirma esto y empezamos 👇
        </Bubble>
      )}

      {/* Campo trampa para robots: las personas no lo ven. */}
      <input value={website} onChange={(e) => setWebsite(e.target.value)} tabIndex={-1} autoComplete="off" aria-hidden="true" className="hidden" />

      <div className="mt-3 pl-9">
        {textStep && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              next();
            }}
            className="flex items-center gap-2"
          >
            {step === "whatsapp" && (
              <select
                value={country}
                onChange={(e) => setCountry(e.target.value)}
                aria-label="País del WhatsApp"
                className="h-11 shrink-0 rounded-2xl bg-white px-2 text-[14px] ring-1 ring-[var(--pvx-paper-3)]"
              >
                {PHONE_COUNTRIES.map((c) => (
                  <option key={c.iso} value={c.iso}>
                    {c.iso} +{c.code}
                  </option>
                ))}
              </select>
            )}
            <input
              ref={inputRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              inputMode={step === "whatsapp" ? "tel" : step === "email" ? "email" : "text"}
              autoComplete={step === "name" ? "name" : step === "whatsapp" ? "tel-national" : step === "email" ? "email" : "organization"}
              placeholder={step === "name" ? "Tu nombre" : step === "whatsapp" ? pc.example : step === "store" ? "Nombre de tu tienda" : "tucorreo@gmail.com"}
              maxLength={step === "email" ? 120 : 80}
              aria-label={step === "name" ? "Tu nombre" : step === "whatsapp" ? "Tu WhatsApp" : step === "store" ? "Nombre de tu tienda" : "Correo (opcional)"}
              className={input}
            />
            {step === "email" && !draft.trim() ? (
              <button type="submit" className="pvx-press h-11 shrink-0 rounded-full bg-[var(--pvx-paper-3)] px-4 text-[14px] font-bold cursor-pointer">
                Saltar
              </button>
            ) : (
              <button type="submit" aria-label="Siguiente" className={go}>
                <IconArrow className="w-5 h-5" />
              </button>
            )}
          </form>
        )}

        {step === "platform" && (
          <div className="flex flex-wrap gap-2">
            {(Object.keys(PLATFORM_LABEL) as Platform[]).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => {
                  setPlatform(p);
                  setStep("email");
                }}
                className="pvx-press rounded-full bg-white px-4 py-2.5 text-[14px] font-bold ring-1 ring-[var(--pvx-paper-3)] hover:ring-[var(--pvx-orange)] cursor-pointer"
              >
                {PLATFORM_LABEL[p]}
              </button>
            ))}
          </div>
        )}

        {step === "consent" && (
          <div className="rounded-2xl bg-white p-3">
            <label className="flex items-start gap-2.5 cursor-pointer">
              <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-0.5 h-5 w-5 shrink-0 accent-[#F95B02]" />
              <span className="text-[13px] leading-snug">
                <b>Quiero recibir gratis por WhatsApp los productos ganadores nuevos.</b>
                <span className="mt-0.5 block text-[12px] text-[var(--pvx-ink-2)]">Puedes darte de baja cuando quieras.</span>
              </span>
            </label>
            <p className="mt-2 text-[12px] text-[var(--pvx-ink-2)]">
              Al registrarte aceptas nuestra{" "}
              <a href={PRIVACY_URL} target="_blank" rel="noopener" className="font-semibold underline underline-offset-2">
                política de privacidad
              </a>
              .
            </p>
            <button
              type="button"
              onClick={submit}
              disabled={busy}
              className="pvx-press mt-3 w-full rounded-full bg-[var(--pvx-orange)] py-3 text-[15px] font-bold text-white hover:bg-[var(--pvx-orange-press)] disabled:opacity-60 cursor-pointer"
            >
              {busy ? "Registrando…" : "Empezar a conversar"}
            </button>
          </div>
        )}

        {error && (
          <p role="alert" className="mt-2 text-[13px] text-[#a12a1f]">
            {error}
          </p>
        )}
        {idx > 0 && step !== "consent" && (
          <button
            type="button"
            onClick={() => {
              setError("");
              setDraft("");
              setStep(STEPS[idx - 1]);
            }}
            className="mt-2 text-[12.5px] font-semibold text-[var(--pvx-ink-3)] underline underline-offset-2 cursor-pointer"
          >
            Volver al paso anterior
          </button>
        )}
      </div>
    </div>
  );
}
