"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Upload, X, Mail, KeyRound, Cake, Landmark } from "lucide-react";
import { BrandMark } from "@/components/brand/DaflowMark";
import { uploadFile } from "@/lib/uploadFile";

type CompanyBankAccount = {
  bankName: string | null;
  bankAccountType: string | null;
  bankAccountNumber: string | null;
  bankAccountHolder: string | null;
  holderIdType: "RUC" | "CEDULA" | null;
  holderIdNumber: string | null;
};

type AdminPayrollBankAccount = CompanyBankAccount;

export function SettingsPanel({
  logoUrl,
  bannerUrl,
  faviconUrl,
  adminEmail,
  adminBirthDate,
}: {
  logoUrl: string | null;
  bannerUrl: string | null;
  faviconUrl: string | null;
  adminEmail: string | null;
  adminBirthDate: string | null;
}) {
  const router = useRouter();
  const [logo, setLogo] = useState(logoUrl);
  const [banner, setBanner] = useState(bannerUrl);
  const [favicon, setFavicon] = useState(faviconUrl);
  const [email, setEmail] = useState(adminEmail ?? "");
  const [birthDate, setBirthDate] = useState(adminBirthDate ? adminBirthDate.slice(0, 10) : "");
  const [logoErr, setLogoErr] = useState("");
  const [bannerErr, setBannerErr] = useState("");
  const [faviconErr, setFaviconErr] = useState("");
  const [emailSaved, setEmailSaved] = useState(false);
  const [birthDateSaved, setBirthDateSaved] = useState(false);

  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordErr, setPasswordErr] = useState("");
  const [passwordSaved, setPasswordSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  const [bankAccount, setBankAccount] = useState<CompanyBankAccount>({
    bankName: "",
    bankAccountType: "",
    bankAccountNumber: "",
    bankAccountHolder: "",
    holderIdType: null,
    holderIdNumber: "",
  });
  const [bankBusy, setBankBusy] = useState(false);
  const [bankSaved, setBankSaved] = useState(false);
  const [bankErr, setBankErr] = useState("");

  useEffect(() => {
    fetch("/api/company-bank-account").then((r) => (r.ok ? r.json() : null)).then((a: CompanyBankAccount | null) => {
      if (a) {
        setBankAccount({
          bankName: a.bankName ?? "",
          bankAccountType: a.bankAccountType ?? "",
          bankAccountNumber: a.bankAccountNumber ?? "",
          bankAccountHolder: a.bankAccountHolder ?? "",
          holderIdType: a.holderIdType,
          holderIdNumber: a.holderIdNumber ?? "",
        });
      }
    });
  }, []);

  const saveBankAccount = async () => {
    setBankErr("");
    setBankBusy(true);
    const res = await fetch("/api/company-bank-account", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        bankName: bankAccount.bankName,
        bankAccountType: bankAccount.bankAccountType,
        bankAccountNumber: bankAccount.bankAccountNumber,
        bankAccountHolder: bankAccount.bankAccountHolder,
        holderIdType: bankAccount.holderIdType ?? undefined,
        holderIdNumber: bankAccount.holderIdNumber || undefined,
      }),
    });
    setBankBusy(false);
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setBankErr(data?.error ?? "No se pudo guardar la cuenta.");
      return;
    }
    setBankSaved(true);
    setTimeout(() => setBankSaved(false), 2500);
  };

  const [payrollBankAccount, setPayrollBankAccount] = useState<AdminPayrollBankAccount>({
    bankName: "",
    bankAccountType: "",
    bankAccountNumber: "",
    bankAccountHolder: "",
    holderIdType: null,
    holderIdNumber: "",
  });
  const [payrollBankBusy, setPayrollBankBusy] = useState(false);
  const [payrollBankSaved, setPayrollBankSaved] = useState(false);
  const [payrollBankErr, setPayrollBankErr] = useState("");

  useEffect(() => {
    fetch("/api/admin-payroll-bank-account").then((r) => (r.ok ? r.json() : null)).then((a: AdminPayrollBankAccount | null) => {
      if (a) {
        setPayrollBankAccount({
          bankName: a.bankName ?? "",
          bankAccountType: a.bankAccountType ?? "",
          bankAccountNumber: a.bankAccountNumber ?? "",
          bankAccountHolder: a.bankAccountHolder ?? "",
          holderIdType: a.holderIdType,
          holderIdNumber: a.holderIdNumber ?? "",
        });
      }
    });
  }, []);

  const savePayrollBankAccount = async () => {
    setPayrollBankErr("");
    setPayrollBankBusy(true);
    const res = await fetch("/api/admin-payroll-bank-account", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        bankName: payrollBankAccount.bankName,
        bankAccountType: payrollBankAccount.bankAccountType,
        bankAccountNumber: payrollBankAccount.bankAccountNumber,
        bankAccountHolder: payrollBankAccount.bankAccountHolder,
        holderIdType: payrollBankAccount.holderIdType ?? undefined,
        holderIdNumber: payrollBankAccount.holderIdNumber || undefined,
      }),
    });
    setPayrollBankBusy(false);
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setPayrollBankErr(data?.error ?? "No se pudo guardar la cuenta.");
      return;
    }
    setPayrollBankSaved(true);
    setTimeout(() => setPayrollBankSaved(false), 2500);
  };

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
    const result = await uploadFile(file, "branding");
    if (!result.ok) {
      setLogoErr(result.error);
      return;
    }
    await fetch("/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ logoUrl: result.url }),
    });
    setLogo(result.url);
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
    const result = await uploadFile(file, "branding");
    if (!result.ok) {
      setBannerErr(result.error);
      return;
    }
    await fetch("/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bannerUrl: result.url }),
    });
    setBanner(result.url);
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

  const handleFaviconFile = async (file: File) => {
    setFaviconErr("");
    if (!file.type.startsWith("image/")) {
      setFaviconErr("Solo se aceptan archivos de imagen (PNG, SVG, ICO).");
      return;
    }
    if (file.size > 500 * 1024) {
      setFaviconErr("La imagen es muy pesada. Usa un ícono de menos de 500 KB.");
      return;
    }
    const result = await uploadFile(file, "branding");
    if (!result.ok) {
      setFaviconErr(result.error);
      return;
    }
    await fetch("/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ faviconUrl: result.url }),
    });
    setFavicon(result.url);
    router.refresh();
  };

  const removeFavicon = async () => {
    await fetch("/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ faviconUrl: null }),
    });
    setFavicon(null);
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

  const saveBirthDate = async (value: string) => {
    setBirthDate(value);
    setBusy(true);
    await fetch("/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ adminBirthDate: value || null }),
    });
    setBusy(false);
    setBirthDateSaved(true);
    setTimeout(() => setBirthDateSaved(false), 2500);
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
        <label className="block mb-3 text-[11px] font-semibold tracking-wide uppercase text-steel">
          Favicon (ícono de la pestaña del navegador)
        </label>
        <div className="flex items-center gap-4.5 mb-4">
          <div className="w-12 h-12 border-[1.5px] border-dashed border-rule rounded-md flex items-center justify-center bg-cloud overflow-hidden">
            {favicon ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={favicon} alt="Favicon" className="max-w-full max-h-full object-contain" />
            ) : (
              <span className="text-[9px] text-steel text-center px-1">Por defecto</span>
            )}
          </div>
          <div className="text-[12px] text-steel leading-relaxed">
            Es el ícono chiquito que se ve en la pestaña del navegador. Si no subes uno, se usa el ícono genérico de
            DAFLOW.
          </div>
        </div>
        <label className="inline-flex items-center gap-1.5 text-[13px] font-semibold border border-blue bg-blue text-white rounded px-3.5 py-2 cursor-pointer">
          <Upload size={14} /> {favicon ? "Cambiar favicon" : "Subir favicon"}
          <input type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && handleFaviconFile(e.target.files[0])} />
        </label>
        {favicon && (
          <button type="button" className="ml-2.5 inline-flex items-center gap-1.5 text-[13px] border border-rule rounded px-3.5 py-2 cursor-pointer" onClick={removeFavicon}>
            <X size={13} /> Quitar favicon
          </button>
        )}
        {faviconErr && <div className="text-red text-[12px] mt-2">{faviconErr}</div>}
        <div className="text-[11px] text-steel mt-3.5">
          Recomendado: imagen cuadrada (ej. 64×64), PNG o SVG, fondo sólido, menos de 500 KB. El cambio puede tardar
          en verse por el caché del navegador — probar en una pestaña nueva o recargando sin caché.
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
          <Cake size={12} /> Tu fecha de cumpleaños
        </label>
        <div className="text-[12px] text-steel mb-3">
          Para que todo el equipo lo sepa el día que corresponda, igual que con el resto de la nómina.
        </div>
        <input
          type="date"
          className="rounded border border-rule px-2.5 py-2 text-[13.5px]"
          value={birthDate}
          onChange={(e) => saveBirthDate(e.target.value)}
        />
        {birthDateSaved && <div className="text-green text-[12px] mt-2">Guardado.</div>}
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

      <div className="bg-surface border border-rule rounded p-4.5">
        <label className="flex items-center gap-1.5 mb-3 text-[11px] font-semibold tracking-wide uppercase text-steel">
          <Landmark size={12} /> Cuenta para recibir transferencias
        </label>
        <div className="text-[12px] text-steel mb-3">
          Es la que ven los colaboradores cuando eligen pagar una compra personal por transferencia.
        </div>
        <div className="grid grid-cols-2 gap-2.5 mb-2.5">
          <input
            className="rounded border border-rule px-2.5 py-2 text-[13.5px]"
            placeholder="Banco"
            value={bankAccount.bankName ?? ""}
            onChange={(e) => setBankAccount((a) => ({ ...a, bankName: e.target.value }))}
          />
          <input
            className="rounded border border-rule px-2.5 py-2 text-[13.5px]"
            placeholder="Tipo de cuenta"
            value={bankAccount.bankAccountType ?? ""}
            onChange={(e) => setBankAccount((a) => ({ ...a, bankAccountType: e.target.value }))}
          />
          <input
            className="rounded border border-rule px-2.5 py-2 text-[13.5px]"
            placeholder="Número de cuenta"
            value={bankAccount.bankAccountNumber ?? ""}
            onChange={(e) => setBankAccount((a) => ({ ...a, bankAccountNumber: e.target.value }))}
          />
          <input
            className="rounded border border-rule px-2.5 py-2 text-[13.5px]"
            placeholder="Titular"
            value={bankAccount.bankAccountHolder ?? ""}
            onChange={(e) => setBankAccount((a) => ({ ...a, bankAccountHolder: e.target.value }))}
          />
          <select
            className="rounded border border-rule px-2.5 py-2 text-[13.5px]"
            value={bankAccount.holderIdType ?? ""}
            onChange={(e) => setBankAccount((a) => ({ ...a, holderIdType: (e.target.value || null) as CompanyBankAccount["holderIdType"] }))}
          >
            <option value="">Cédula o RUC</option>
            <option value="CEDULA">Cédula</option>
            <option value="RUC">RUC</option>
          </select>
          <input
            className="rounded border border-rule px-2.5 py-2 text-[13.5px]"
            placeholder="Número de cédula/RUC"
            value={bankAccount.holderIdNumber ?? ""}
            onChange={(e) => setBankAccount((a) => ({ ...a, holderIdNumber: e.target.value }))}
          />
        </div>
        <button type="button" disabled={bankBusy} className="rounded border border-blue bg-blue px-4 py-2 text-[13px] font-semibold text-white cursor-pointer disabled:opacity-60" onClick={saveBankAccount}>
          Guardar
        </button>
        {bankErr && <div className="text-red text-[12px] mt-2">{bankErr}</div>}
        {bankSaved && <div className="text-green text-[12px] mt-2">Cuenta guardada.</div>}
      </div>

      <div className="bg-surface border border-rule rounded p-4.5">
        <label className="flex items-center gap-1.5 mb-3 text-[11px] font-semibold tracking-wide uppercase text-steel">
          <Landmark size={12} /> Cuenta Produbanco para nómina (fin de mes)
        </label>
        <div className="text-[12px] text-steel mb-3">
          A esta cuenta se transfiere el total de la 2da quincena/fin de mes — Nairoby entra ahí y paga a cada
          colaborador. Confidencial: solo vos y Nairoby la ven, nunca los demás colaboradores.
        </div>
        <div className="grid grid-cols-2 gap-2.5 mb-2.5">
          <input
            className="rounded border border-rule px-2.5 py-2 text-[13.5px]"
            placeholder="Banco"
            value={payrollBankAccount.bankName ?? ""}
            onChange={(e) => setPayrollBankAccount((a) => ({ ...a, bankName: e.target.value }))}
          />
          <input
            className="rounded border border-rule px-2.5 py-2 text-[13.5px]"
            placeholder="Tipo de cuenta"
            value={payrollBankAccount.bankAccountType ?? ""}
            onChange={(e) => setPayrollBankAccount((a) => ({ ...a, bankAccountType: e.target.value }))}
          />
          <input
            className="rounded border border-rule px-2.5 py-2 text-[13.5px]"
            placeholder="Número de cuenta"
            value={payrollBankAccount.bankAccountNumber ?? ""}
            onChange={(e) => setPayrollBankAccount((a) => ({ ...a, bankAccountNumber: e.target.value }))}
          />
          <input
            className="rounded border border-rule px-2.5 py-2 text-[13.5px]"
            placeholder="Titular"
            value={payrollBankAccount.bankAccountHolder ?? ""}
            onChange={(e) => setPayrollBankAccount((a) => ({ ...a, bankAccountHolder: e.target.value }))}
          />
          <select
            className="rounded border border-rule px-2.5 py-2 text-[13.5px]"
            value={payrollBankAccount.holderIdType ?? ""}
            onChange={(e) => setPayrollBankAccount((a) => ({ ...a, holderIdType: (e.target.value || null) as AdminPayrollBankAccount["holderIdType"] }))}
          >
            <option value="">Cédula o RUC</option>
            <option value="CEDULA">Cédula</option>
            <option value="RUC">RUC</option>
          </select>
          <input
            className="rounded border border-rule px-2.5 py-2 text-[13.5px]"
            placeholder="Número de cédula/RUC"
            value={payrollBankAccount.holderIdNumber ?? ""}
            onChange={(e) => setPayrollBankAccount((a) => ({ ...a, holderIdNumber: e.target.value }))}
          />
        </div>
        <button type="button" disabled={payrollBankBusy} className="rounded border border-blue bg-blue px-4 py-2 text-[13px] font-semibold text-white cursor-pointer disabled:opacity-60" onClick={savePayrollBankAccount}>
          Guardar
        </button>
        {payrollBankErr && <div className="text-red text-[12px] mt-2">{payrollBankErr}</div>}
        {payrollBankSaved && <div className="text-green text-[12px] mt-2">Cuenta guardada.</div>}
      </div>
    </div>
  );
}
