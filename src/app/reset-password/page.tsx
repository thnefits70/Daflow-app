"use client";

import { useState, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Lock } from "lucide-react";
import { BrandMark, DaflowWordmark } from "@/components/brand/DaflowMark";

function ResetPasswordForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token") || "";

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  const submit = async () => {
    if (password.length < 6) {
      setErr("La contraseña debe tener al menos 6 caracteres.");
      return;
    }
    if (password !== confirm) {
      setErr("Las contraseñas no coinciden.");
      return;
    }
    setErr("");
    setLoading(true);
    const res = await fetch("/api/auth/reset-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, password }),
    });
    setLoading(false);
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setErr(data?.error ?? "No se pudo restablecer la contraseña.");
      return;
    }
    setDone(true);
    setTimeout(() => router.push("/login"), 2000);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-navy p-8">
      <div className="w-full max-w-sm rounded-md bg-cloud p-9">
        <div className="flex items-center gap-2.5 mb-6">
          <BrandMark size={40} />
          <DaflowWordmark />
        </div>

        {done ? (
          <div className="text-[13.5px] leading-relaxed">
            Contraseña actualizada. Redirigiendo al inicio de sesión…
          </div>
        ) : !token ? (
          <div className="text-[13.5px] leading-relaxed">
            Este enlace no es válido.{" "}
            <Link href="/forgot-password" className="text-blue">
              Solicita uno nuevo
            </Link>
            .
          </div>
        ) : (
          <>
            <div className="mb-3.5">
              <label className="block mb-1.5 text-[11px] font-semibold tracking-wide uppercase text-steel">
                Nueva contraseña
              </label>
              <input
                type="password"
                className="w-full rounded border border-rule bg-white px-2.5 py-2 text-[13.5px]"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            <div className="mb-3.5">
              <label className="block mb-1.5 text-[11px] font-semibold tracking-wide uppercase text-steel">
                Confirmar contraseña
              </label>
              <input
                type="password"
                className="w-full rounded border border-rule bg-white px-2.5 py-2 text-[13.5px]"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && submit()}
              />
            </div>
            {err && <div className="text-red text-[12.5px] mb-3">{err}</div>}
            <button
              type="button"
              disabled={loading}
              className="w-full flex items-center justify-center gap-1.5 rounded border border-blue bg-blue px-4 py-2.5 text-[13px] font-semibold text-white cursor-pointer disabled:opacity-60"
              onClick={submit}
            >
              <Lock size={14} /> {loading ? "Guardando…" : "Restablecer contraseña"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense>
      <ResetPasswordForm />
    </Suspense>
  );
}
