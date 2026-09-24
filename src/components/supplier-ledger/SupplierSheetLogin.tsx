"use client";

import { useState } from "react";

// Confirmado 2026-09-24, pedido explícito del usuario: aunque alguien tenga
// el enlace de la hoja de CHEN, no ve nada hasta entrar con un correo de la
// lista del admin + el código de 6 dígitos que le llega a ese correo.
export function SupplierSheetLogin({ token }: { token: string }) {
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [info, setInfo] = useState("");

  async function requestCode(e?: React.FormEvent) {
    e?.preventDefault();
    setErr("");
    setInfo("");
    setBusy(true);
    const res = await fetch(`/api/proveedor-ledger/${token}/hoja/login/request`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    }).catch(() => null);
    setBusy(false);
    if (!res || !res.ok) {
      const d = await res?.json().catch(() => ({}));
      setErr(d?.error ?? "No se pudo continuar. Revisa tu conexión.");
      return;
    }
    setStep("code");
    setInfo("Si tu correo tiene acceso, te llegó un código de 6 números. Revisa también la carpeta de spam.");
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    setBusy(true);
    const res = await fetch(`/api/proveedor-ledger/${token}/hoja/login/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, code }),
    }).catch(() => null);
    if (!res || !res.ok) {
      setBusy(false);
      const d = await res?.json().catch(() => ({}));
      setErr(d?.error ?? "No se pudo continuar. Revisa tu conexión.");
      return;
    }
    window.location.reload();
  }

  const input = "w-full rounded-md border border-neutral-300 bg-white px-3 py-2.5 text-[15px] outline-none focus:border-[#0b57d0] focus:ring-2 focus:ring-[#0b57d0]/20";
  const button = "w-full rounded-md bg-[#0b57d0] px-3 py-2.5 text-[14px] font-medium text-white hover:bg-[#0a4cb8] disabled:opacity-60";

  return (
    <div className="flex min-h-dvh items-center justify-center bg-[#f6f8fc] px-4 text-neutral-900 [color-scheme:light]">
      <div className="w-full max-w-[380px] rounded-xl border border-neutral-200 bg-white p-6 shadow-sm">
        <div className="mb-5 flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded bg-[#0f9d58] text-white">
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor" aria-hidden>
              <path d="M5 3h10l4 4v14H5V3zm2 8v2h4v-2H7zm6 0v2h4v-2h-4zm-6 4v2h4v-2H7zm6 0v2h4v-2h-4z" />
            </svg>
          </div>
          <div>
            <div className="text-[17px] font-medium">Hoja de cálculo del equipo</div>
            <div className="text-[12.5px] text-neutral-500">Acceso solo para correos autorizados</div>
          </div>
        </div>

        {step === "email" ? (
          <form onSubmit={requestCode} className="flex flex-col gap-3">
            <label className="text-[13px] text-neutral-700" htmlFor="sheet-email">Tu correo</label>
            <input
              id="sheet-email"
              type="email"
              inputMode="email"
              autoComplete="email"
              autoFocus
              required
              className={input}
              placeholder="nombre@gmail.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <button type="submit" className={button} disabled={busy || !email.trim()}>
              {busy ? "Enviando…" : "Enviarme el código"}
            </button>
          </form>
        ) : (
          <form onSubmit={verify} className="flex flex-col gap-3">
            <div className="text-[13px] text-neutral-700">
              Código enviado a <span className="font-medium">{email}</span>
            </div>
            <input
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              autoFocus
              maxLength={6}
              className={`${input} text-center text-[22px] tracking-[0.4em]`}
              placeholder="000000"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
            />
            <button type="submit" className={button} disabled={busy || code.length !== 6}>
              {busy ? "Entrando…" : "Entrar"}
            </button>
            <div className="flex justify-between text-[12.5px]">
              <button type="button" className="text-[#0b57d0] hover:underline" onClick={() => { setStep("email"); setCode(""); setErr(""); setInfo(""); }}>
                Cambiar correo
              </button>
              <button type="button" className="text-[#0b57d0] hover:underline disabled:opacity-50" disabled={busy} onClick={() => void requestCode()}>
                Reenviar código
              </button>
            </div>
          </form>
        )}

        {info && <p className="mt-4 text-[12.5px] text-neutral-600">{info}</p>}
        {err && <p className="mt-4 text-[12.5px] text-red-600">{err}</p>}
      </div>
    </div>
  );
}
