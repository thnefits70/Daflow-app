"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Upload, X, Mail, KeyRound } from "lucide-react";
import { BrandMark } from "@/components/brand/DaflowMark";

export function SettingsPanel({
  logoUrl,
  bannerUrl,
  adminEmail,
}: {
  logoUrl: string | null;
  bannerUrl: string | null;
  adminEmail: string | null;
}) {
  const router = useRouter();
  const [logo, setLogo] = useState(logoUrl);
  const [banner, setBanner] = useState(bannerUrl);
  const [email, setEmail] = useState(adminEmail ?? "");
  const [logoErr, setLogoErr] = useState("");
  const [bannerErr, setBannerErr] = useState("");
  const [emailSaved, setEmailSaved] = useState(false);

  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordErr, setPasswordErr] = useState("");
  const [passwordSaved, setPasswordSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  const handleLogoFile = async (file: File) => {
    setLogoErr("");
    if (!file.type.startsWith("image/")) {
      setLogoErr("Solo se aceptan archivos de imagen (PNG, JPG, SVG).");
      return;
    }
    if (file.size > 1.5 * 1024 * 1024) {
      setLogoErr("La imagen es muy pesada. Usa un logo de menos de 1.5 MB.");
      return;
    }
    const fd = new FormData();
    fd.append("file", file);
    fd.append("folder", "branding");
    const res = await fetch("/api/upload", { method: "POST", body: fd });
    if (!res.ok) {
      setLogoErr("No se pudo subir el logo.");
      return;
    }
    const data = await res.json();
    await fetch("/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ logoUrl: data.url }),
    });
    setLogo(data.url);
    router.refresh();
  };

  const removeLogo = async () => {
    await fetch("/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ logoUrl: null }),
    });
    setLogo(null);
    router.refresh();
  };

  const handleBannerFile = async (file: File) => {
    setBannerErr("");
    if (!file.type.startsWith("image/")) {
      setBannerErr("Solo se aceptan archivos de imagen (PNG, JPG, SVG).");
      return;
    }
    if (file.size > 2.5 * 1024 * 1024) {
      setBannerErr("La imagen es muy pesada. Usa un banner de menos de 2.5 MB.");
      return;
    }
    const fd = new FormData();
    fd.append("file", file);
    fd.append("folder", "branding");
    const res = await fetch("/api/upload", { method: "POST", body: fd });
    if (!res.ok) {
      setBannerErr("No se pudo subir el banner.");
      return;
    }
    const data = await res.json();
    await fetch("/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bannerUrl: data.url }),
    });
    setBanner(data.url);
    router.refresh();
  };

  const removeBanner = async () => {
    await fetch("/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bannerUrl: null }),
    });
    setBanner(null);
    router.refresh();
  };

  const saveEmail = async () => {
    setBusy(true);
    await fetch("/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ adminEmail: email.trim() }),
    });
    setBusy(false);
    setEmailSaved(true);
    setTimeout(() => setEmailSaved(false), 2500);
  };

  const savePassword = async () => {
    if (newPassword.length < 6) {
      setPasswordErr("La contraseña debe tener al menos 6 caracteres.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordErr("Las contraseñas no coinciden.");
      return;
    }
    setPasswordErr("");
    setBusy(true);
    const res = await fetch("/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ newPassword }),
    });
    setBusy(false);
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setPasswordErr(data?.error ?? "No se pudo cambiar la contraseña.");
      return;
    }
    setNewPassword("");
    setConfirmPassword("");
    setPasswordSaved(true);
    setTimeout(() => setPasswordSaved(false), 2500);
  };

  return (
    <div className="space-y-5 max-w-lg">
      <div className="bg-surface border border-rule rounded p-4.5">
        <label className="block mb-3 text-[11px] font-semibold tracking-wide uppercase text-steel">
          Logo principal
        </label>
        <div className="flex items-center gap-4.5 mb-4">
          <div className="w-20 h-20 border-[1.5px] border-dashed border-rule rounded-md flex items-center justify-center bg-cloud">
            <BrandMark logoUrl={logo} size={56} />
          </div>
          <div className="text-[12px] text-steel leading-relaxed">
            Así se verá tu logo en el inicio de sesión y en el menú lateral, en fondo claro y oscuro.
          </div>
        </div>
        <label className="inline-flex items-center gap-1.5 text-[13px] font-semibold border border-blue bg-blue text-white rounded px-3.5 py-2 cursor-pointer">
          <Upload size={14} /> {logo ? "Cambiar logo" : "Subir logo"}
          <input type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && handleLogoFile(e.target.files[0])} />
        </label>
        {logo && (
          <button type="button" className="ml-2.5 inline-flex items-center gap-1.5 text-[13px] border border-rule rounded px-3.5 py-2 cursor-pointer" onClick={removeLogo}>
            <X size={13} /> Quitar logo
          </button>
        )}
        {logoErr && <div className="text-red text-[12px] mt-2">{logoErr}</div>}
        <div className="text-[11px] text-steel mt-3.5">
          Recomendado: PNG con fondo transparente, cuadrado o poco alargado, menos de 1.5 MB.
        </div>
      </div>

      <div className="bg-surface border border-rule rounded p-4.5">
        <label className="block mb-3 text-[11px] font-semibold tracking-wide uppercase text-steel">
          Banner de Inicio
        </label>
        <div className="mb-4">
          <div className="w-full h-24 border-[1.5px] border-dashed border-rule rounded-md flex items-center justify-center bg-cloud overflow-hidden mb-3">
            {banner ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={banner} alt="Banner" className="max-w-full max-h-full object-contain opacity-70" />
            ) : (
              <span className="text-[12px] text-steel">Sin banner</span>
            )}
          </div>
          <div className="text-[12px] text-steel leading-relaxed">
            Se muestra centrado en la parte superior de todas las secciones de la plataforma (Inicio, áreas,
            nómina, leyes, etc.), tanto para administrador como para el equipo. No aparece en Configuración.
          </div>
        </div>
        <label className="inline-flex items-center gap-1.5 text-[13px] font-semibold border border-blue bg-blue text-white rounded px-3.5 py-2 cursor-pointer">
          <Upload size={14} /> {banner ? "Cambiar banner" : "Subir banner"}
          <input type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && handleBannerFile(e.target.files[0])} />
        </label>
        {banner && (
          <button type="button" className="ml-2.5 inline-flex items-center gap-1.5 text-[13px] border border-rule rounded px-3.5 py-2 cursor-pointer" onClick={removeBanner}>
            <X size={13} /> Quitar banner
          </button>
        )}
        {bannerErr && <div className="text-red text-[12px] mt-2">{bannerErr}</div>}
        <div className="text-[11px] text-steel mt-3.5">
          Recomendado: logo + nombre horizontal, fondo transparente, menos de 2.5 MB.
        </div>
      </div>

      <div className="bg-surface border border-rule rounded p-4.5">
        <label className="flex items-center gap-1.5 mb-3 text-[11px] font-semibold tracking-wide uppercase text-steel">
          <Mail size={12} /> Correo de recuperación de administrador
        </label>
        <div className="text-[12px] text-steel mb-3">
          A este correo se enviará el enlace si alguna vez usas &quot;¿Olvidaste tu contraseña?&quot; en el login.
        </div>
        <div className="flex gap-2">
          <input
            className="flex-1 rounded border border-rule px-2.5 py-2 text-[13.5px]"
            placeholder="tucorreo@empresa.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <button type="button" disabled={busy} className="rounded border border-blue bg-blue px-4 py-2 text-[13px] font-semibold text-white cursor-pointer disabled:opacity-60" onClick={saveEmail}>
            Guardar
          </button>
        </div>
        {emailSaved && <div className="text-green text-[12px] mt-2">Correo guardado.</div>}
      </div>

      <div className="bg-surface border border-rule rounded p-4.5">
        <label className="flex items-center gap-1.5 mb-3 text-[11px] font-semibold tracking-wide uppercase text-steel">
          <KeyRound size={12} /> Cambiar contraseña de administrador
        </label>
        <div className="grid grid-cols-2 gap-2.5 mb-3">
          <input
            type="password"
            className="rounded border border-rule px-2.5 py-2 text-[13.5px]"
            placeholder="Nueva contraseña"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
          />
          <input
            type="password"
            className="rounded border border-rule px-2.5 py-2 text-[13.5px]"
            placeholder="Confirmar contraseña"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
          />
        </div>
        <button type="button" disabled={busy} className="rounded border border-blue bg-blue px-4 py-2 text-[13px] font-semibold text-white cursor-pointer disabled:opacity-60" onClick={savePassword}>
          Guardar contraseña
        </button>
        {passwordErr && <div className="text-red text-[12px] mt-2">{passwordErr}</div>}
        {passwordSaved && <div className="text-green text-[12px] mt-2">Contraseña actualizada.</div>}
      </div>
    </div>
  );
}
