"use client";

import { useState } from "react";
import Link from "next/link";
import { Mail, ArrowLeft } from "lucide-react";
import { BrandMark, DaflowWordmark } from "@/components/brand/DaflowMark";

export default function ForgotPasswordPage() {
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    setLoading(true);
    await fetch("/api/auth/forgot-password", { method: "POST" });
    setLoading(false);
    setSent(true);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-navy p-8">
      <div className="w-full max-w-sm rounded-md bg-cloud p-9">
        <div className="flex items-center gap-2.5 mb-6">
          <BrandMark size={40} />
          <DaflowWordmark />
        </div>

        {sent ? (
          <>
            <div className="text-[13.5px] leading-relaxed mb-5">
              Si hay un correo de administrador configurado, te enviamos un enlace para restablecer la contraseña.
              Revisa tu bandeja de entrada (y spam). El enlace expira en 30 minutos.
            </div>
            <Link href="/login" className="inline-flex items-center gap-1.5 text-[13px] text-steel hover:text-ink">
              <ArrowLeft size={14} /> Volver al inicio de sesión
            </Link>
          </>
        ) : (
          <>
            <div className="text-[13.5px] text-steel leading-relaxed mb-5">
              Te enviaremos un enlace de recuperación al correo de administrador configurado en Configuración.
            </div>
            <button
              type="button"
              disabled={loading}
              className="w-full flex items-center justify-center gap-1.5 rounded border border-blue bg-blue px-4 py-2.5 text-[13px] font-semibold text-white cursor-pointer disabled:opacity-60"
              onClick={submit}
            >
              <Mail size={14} /> {loading ? "Enviando…" : "Enviar enlace de recuperación"}
            </button>
            <Link href="/login" className="inline-flex items-center gap-1.5 text-[12.5px] text-steel hover:text-ink mt-4">
              <ArrowLeft size={13} /> Volver al inicio de sesión
            </Link>
          </>
        )}
      </div>
    </div>
  );
}
