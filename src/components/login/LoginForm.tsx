"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import Link from "next/link";
import { Lock } from "lucide-react";
import { BrandMark, DaflowWordmark } from "@/components/brand/DaflowMark";

export function LoginForm({ logoUrl }: { logoUrl: string | null }) {
  const router = useRouter();
  const [mode, setMode] = useState<"team" | "admin">("team");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    setErr("");
    setLoading(true);
    const res = await signIn("credentials", {
      mode,
      username,
      password,
      redirect: false,
    });
    setLoading(false);

    if (!res || res.error) {
      setErr(
        mode === "admin"
          ? "Contraseña de administrador incorrecta."
          : "Usuario o contraseña incorrectos. Verifica con tu administrador."
      );
      return;
    }
    router.replace(mode === "admin" ? "/admin" : "/area");
    router.refresh();
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-navy p-8">
      <div className="w-full max-w-sm rounded-md bg-cloud p-9">
        <div className="flex items-center gap-2.5 mb-6">
          <BrandMark logoUrl={logoUrl} size={40} />
          <DaflowWordmark />
        </div>

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
      </div>
    </div>
  );
}
