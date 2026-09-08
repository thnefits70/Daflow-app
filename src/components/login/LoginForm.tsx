"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import Link from "next/link";
import { Lock, ShieldCheck, Copy, Check } from "lucide-react";
import { BrandMark, DaflowWordmark } from "@/components/brand/DaflowMark";
import { LoginBackground } from "./LoginBackground";

type Step = "credentials" | "totp" | "enroll" | "backup-codes";

export function LoginForm({ logoUrl }: { logoUrl: string | null }) {
  const router = useRouter();
  const [mode, setMode] = useState<"team" | "admin">("team");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);

  const [step, setStep] = useState<Step>("credentials");
  const [totpCode, setTotpCode] = useState("");
  const [enrollSecret, setEnrollSecret] = useState("");
  const [enrollQrDataUrl, setEnrollQrDataUrl] = useState("");
  const [enrollCode, setEnrollCode] = useState("");
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [copied, setCopied] = useState(false);

  const resetTwoFactorState = () => {
    setStep("credentials");
    setTotpCode("");
    setEnrollSecret("");
    setEnrollQrDataUrl("");
    setEnrollCode("");
    setBackupCodes([]);
  };

  const finishLogin = async (totp?: string) => {
    const res = await signIn("credentials", { mode, username, password, totp, redirect: false });
    if (!res || res.error) {
      setErr(mode === "admin" ? "Código incorrecto." : "Código incorrecto.");
      return false;
    }
    router.replace(mode === "admin" ? "/admin" : "/area");
    router.refresh();
    return true;
  };

  const submit = async () => {
    setErr("");
    setLoading(true);
    const res = await fetch("/api/auth/2fa-check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode, username, password }),
    });
    const data = await res.json().catch(() => null);
    setLoading(false);

    if (!res.ok || !data?.ok) {
      setErr(
        data?.error ??
          (mode === "admin"
            ? "Contraseña de administrador incorrecta."
            : "Usuario o contraseña incorrectos. Verifica con tu administrador.")
      );
      return;
    }

    if (!data.totpRequired) {
      await finishLogin();
      return;
    }

    if (data.enroll) {
      setEnrollSecret(data.secret);
      setEnrollQrDataUrl(data.qrDataUrl);
      setStep("enroll");
      return;
    }

    setStep("totp");
  };

  const submitTotp = async () => {
    setErr("");
    setLoading(true);
    await finishLogin(totpCode);
    setLoading(false);
  };

  const submitEnrollConfirm = async () => {
    setErr("");
    setLoading(true);
    const res = await fetch("/api/auth/2fa-enroll-confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode, username, password, secret: enrollSecret, code: enrollCode }),
    });
    const data = await res.json().catch(() => null);
    setLoading(false);
    if (!res.ok || !data?.ok) {
      setErr(data?.error ?? "Código incorrecto.");
      return;
    }
    setBackupCodes(data.backupCodes);
    setStep("backup-codes");
  };

  const finishEnrollment = async () => {
    setErr("");
    setLoading(true);
    await finishLogin(enrollCode);
    setLoading(false);
  };

  const copyBackupCodes = () => {
    navigator.clipboard.writeText(backupCodes.join("\n")).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <div className="relative min-h-screen flex items-center justify-center bg-navy p-8">
      <LoginBackground />
      <div className="relative w-full max-w-sm rounded-md bg-cloud p-9">
        <div className="flex items-center gap-2.5 mb-6">
          <BrandMark logoUrl={logoUrl} size={40} />
          <DaflowWordmark />
        </div>

        {step === "credentials" && (
          <>
            <div className="flex border border-rule rounded overflow-hidden mb-5">
              <button
                type="button"
                className={`flex-1 text-center py-2.5 text-[12.5px] font-semibold cursor-pointer ${
                  mode === "team" ? "bg-blue text-white" : "text-steel"
                }`}
                onClick={() => {
                  setMode("team");
                  setErr("");
                }}
              >
                Soy del equipo
              </button>
              <button
                type="button"
                className={`flex-1 text-center py-2.5 text-[12.5px] font-semibold cursor-pointer ${
                  mode === "admin" ? "bg-blue text-white" : "text-steel"
                }`}
                onClick={() => {
                  setMode("admin");
                  setErr("");
                }}
              >
                Administrador
              </button>
            </div>

            {mode === "team" && (
              <div className="mb-3.5">
                <label className="block mb-1.5 text-[11px] font-semibold tracking-wide uppercase text-steel">
                  Usuario
                </label>
                <input
                  className="w-full rounded border border-rule bg-surface px-2.5 py-2 text-[13.5px] text-ink outline-none focus:ring-2 focus:ring-blue"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && submit()}
                  placeholder="ej. ana.perez"
                />
              </div>
            )}

            <div className="mb-3.5">
              <label className="block mb-1.5 text-[11px] font-semibold tracking-wide uppercase text-steel">
                Contraseña
              </label>
              <input
                type="password"
                className="w-full rounded border border-rule bg-surface px-2.5 py-2 text-[13.5px] text-ink outline-none focus:ring-2 focus:ring-blue"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && submit()}
                placeholder="••••••••"
              />
            </div>

            {err && <div className="text-red text-[12.5px] mt-2">{err}</div>}

            <button
              type="button"
              disabled={loading}
              className="mt-1.5 w-full flex items-center justify-center gap-1.5 rounded border border-blue bg-blue px-4 py-2.5 text-[13px] font-semibold text-white cursor-pointer disabled:opacity-60"
              onClick={submit}
            >
              <Lock size={14} /> {loading ? "Ingresando…" : "Ingresar"}
            </button>

            {mode === "admin" && (
              <div className="mt-3.5 text-center">
                <Link href="/forgot-password" className="text-[12px] text-steel hover:text-ink underline underline-offset-2">
                  ¿Olvidaste tu contraseña?
                </Link>
              </div>
            )}
          </>
        )}

        {step === "totp" && (
          <>
            <div className="flex items-center gap-2 mb-3.5">
              <ShieldCheck size={16} className="text-blue" />
              <div className="text-[13px] font-semibold">Verificación en dos pasos</div>
            </div>
            <div className="text-[12.5px] text-steel leading-relaxed mb-4">
              Abre tu app autenticadora (ej. Google Authenticator) e ingresa el código de 6 dígitos. Si perdiste el
              celular, puedes usar uno de tus códigos de respaldo.
            </div>
            <input
              className="w-full rounded border border-rule bg-surface px-2.5 py-2 text-[15px] tracking-widest text-center text-ink outline-none focus:ring-2 focus:ring-blue"
              value={totpCode}
              onChange={(e) => setTotpCode(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submitTotp()}
              placeholder="000000"
              autoFocus
            />
            {err && <div className="text-red text-[12.5px] mt-2">{err}</div>}
            <button
              type="button"
              disabled={loading}
              className="mt-3.5 w-full flex items-center justify-center gap-1.5 rounded border border-blue bg-blue px-4 py-2.5 text-[13px] font-semibold text-white cursor-pointer disabled:opacity-60"
              onClick={submitTotp}
            >
              {loading ? "Verificando…" : "Verificar"}
            </button>
            <button
              type="button"
              className="mt-3 w-full text-center text-[12px] text-steel hover:text-ink cursor-pointer"
              onClick={() => {
                setErr("");
                resetTwoFactorState();
              }}
            >
              Volver
            </button>
          </>
        )}

        {step === "enroll" && (
          <>
            <div className="flex items-center gap-2 mb-3.5">
              <ShieldCheck size={16} className="text-blue" />
              <div className="text-[13px] font-semibold">Configura tu autenticador</div>
            </div>
            <div className="text-[12.5px] text-steel leading-relaxed mb-4">
              Es la primera vez que entras. Escanea este código QR con Google Authenticator (o cualquier app
              compatible) y luego escribe el código de 6 dígitos que te muestra.
            </div>
            {enrollQrDataUrl && (
              <div className="flex justify-center mb-4">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={enrollQrDataUrl} alt="Código QR del autenticador" className="w-40 h-40 rounded border border-rule bg-white p-2" />
              </div>
            )}
            <input
              className="w-full rounded border border-rule bg-surface px-2.5 py-2 text-[15px] tracking-widest text-center text-ink outline-none focus:ring-2 focus:ring-blue"
              value={enrollCode}
              onChange={(e) => setEnrollCode(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submitEnrollConfirm()}
              placeholder="000000"
              autoFocus
            />
            {err && <div className="text-red text-[12.5px] mt-2">{err}</div>}
            <button
              type="button"
              disabled={loading}
              className="mt-3.5 w-full flex items-center justify-center gap-1.5 rounded border border-blue bg-blue px-4 py-2.5 text-[13px] font-semibold text-white cursor-pointer disabled:opacity-60"
              onClick={submitEnrollConfirm}
            >
              {loading ? "Confirmando…" : "Confirmar y activar"}
            </button>
            <button
              type="button"
              className="mt-3 w-full text-center text-[12px] text-steel hover:text-ink cursor-pointer"
              onClick={() => {
                setErr("");
                resetTwoFactorState();
              }}
            >
              Volver
            </button>
          </>
        )}

        {step === "backup-codes" && (
          <>
            <div className="flex items-center gap-2 mb-3.5">
              <ShieldCheck size={16} className="text-green" />
              <div className="text-[13px] font-semibold">Guarda tus códigos de respaldo</div>
            </div>
            <div className="text-[12.5px] text-steel leading-relaxed mb-3.5">
              Úsalos si algún día pierdes el celular con tu autenticador — cada uno sirve una sola vez. Guárdalos en
              un lugar seguro; no se van a volver a mostrar.
            </div>
            <div className="rounded border border-rule bg-surface p-3 mb-3.5">
              <div className="grid grid-cols-2 gap-1.5 font-mono text-[13px] text-ink">
                {backupCodes.map((c) => (
                  <div key={c}>{c}</div>
                ))}
              </div>
            </div>
            <button
              type="button"
              className="w-full flex items-center justify-center gap-1.5 rounded border border-rule px-3.5 py-2 text-[12.5px] font-semibold cursor-pointer mb-3.5"
              onClick={copyBackupCodes}
            >
              {copied ? <Check size={14} className="text-green" /> : <Copy size={14} />} {copied ? "Copiados" : "Copiar códigos"}
            </button>
            {err && <div className="text-red text-[12.5px] mt-2 mb-2">{err}</div>}
            <button
              type="button"
              disabled={loading}
              className="w-full flex items-center justify-center gap-1.5 rounded border border-blue bg-blue px-4 py-2.5 text-[13px] font-semibold text-white cursor-pointer disabled:opacity-60"
              onClick={finishEnrollment}
            >
              {loading ? "Ingresando…" : "Ya los guardé, continuar"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
