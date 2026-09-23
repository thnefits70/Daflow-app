"use client";

import { useEffect, useState } from "react";
import { Bell, BellOff, Share, SquarePlus, ChevronRight } from "lucide-react";

const SW_URL = "/proveedor-ledger/sw.js";

function urlBase64ToUint8Array(base64: string) {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const base64Safe = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64Safe);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

// Misma detección que PushOptIn: en iPhone, PushManager solo existe cuando
// la página se abrió desde el ícono de la pantalla de inicio.
function isIOS() {
  const ua = navigator.userAgent;
  return /iPad|iPhone|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

function isStandalone() {
  const nav = window.navigator as Navigator & { standalone?: boolean };
  return window.matchMedia("(display-mode: standalone)").matches || nav.standalone === true;
}

type Mode = "loading" | "unsupported" | "ios-install" | "off" | "on" | "denied";

// Confirmado 2026-09-23, pedido explícito del usuario: el equipo de despacho
// de CHEN activa aquí los avisos — les llega una notificación cada vez que
// les pedimos algo nuevo (con cuántos pedidos les quedan por enviar) y un
// recordatorio diario mientras quede algo pendiente, sin tener que entrar al
// enlace a revisar. Cada celular/laptop se activa por separado.
export function SupplierShippingPushToggle({ token }: { token: string }) {
  const [mode, setMode] = useState<Mode>("loading");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function detect(): Promise<Mode> {
      if (isIOS() && !isStandalone()) return "ios-install";
      if (!("Notification" in window) || !("serviceWorker" in navigator) || !("PushManager" in window)) return "unsupported";
      if (Notification.permission === "denied") return "denied";
      const registration = await navigator.serviceWorker.getRegistration(SW_URL);
      const sub = await registration?.pushManager.getSubscription();
      return sub ? "on" : "off";
    }
    detect()
      .catch(() => "unsupported" as const)
      .then((m) => {
        if (!cancelled) setMode(m);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function activate() {
    setBusy(true);
    setErr("");
    try {
      const registration = await navigator.serviceWorker.register(SW_URL);
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setMode(permission === "denied" ? "denied" : "off");
        return;
      }
      const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
      if (!publicKey) throw new Error("missing key");
      await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });
      const res = await fetch(`/api/proveedor-ledger/${token}/push-subscribe`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(subscription.toJSON()),
      });
      if (!res.ok) throw new Error("subscribe failed");
      setMode("on");
    } catch {
      setErr("No se pudo activar. Intenta de nuevo.");
    } finally {
      setBusy(false);
    }
  }

  async function deactivate() {
    setBusy(true);
    setErr("");
    try {
      const registration = await navigator.serviceWorker.getRegistration(SW_URL);
      const sub = await registration?.pushManager.getSubscription();
      if (sub) {
        await fetch(`/api/proveedor-ledger/${token}/push-subscribe`, {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        });
        await sub.unsubscribe();
      }
      setMode("off");
    } catch {
      setErr("No se pudo desactivar. Intenta de nuevo.");
    } finally {
      setBusy(false);
    }
  }

  if (mode === "loading" || mode === "unsupported") return null;

  const box = "mb-6 rounded-lg border border-neutral-200 bg-white p-4";

  if (mode === "ios-install") {
    return (
      <div className={box}>
        <div className="flex items-start gap-3">
          <Bell size={18} className="mt-0.5 shrink-0 text-neutral-500" />
          <div>
            <p className="text-sm font-medium">Reciba un aviso en su iPhone cada vez que le pedimos algo</p>
            <p className="mt-0.5 text-xs text-neutral-500">En iPhone hay que hacer esto una sola vez (sirve desde Safari o Chrome):</p>
          </div>
        </div>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <div className="flex flex-1 items-center gap-2 rounded-md bg-neutral-100 px-3 py-2 text-xs">
            <Share size={14} className="shrink-0 text-neutral-600" /> Toque compartir (el cuadrito con la flecha ⬆) <ChevronRight size={12} className="shrink-0 text-neutral-400" />
          </div>
          <div className="flex flex-1 items-center gap-2 rounded-md bg-neutral-100 px-3 py-2 text-xs">
            <SquarePlus size={14} className="shrink-0 text-neutral-600" /> “Añadir a pantalla de inicio” <ChevronRight size={12} className="shrink-0 text-neutral-400" />
          </div>
          <div className="flex flex-1 items-center gap-2 rounded-md bg-neutral-100 px-3 py-2 text-xs">
            <Bell size={14} className="shrink-0 text-neutral-600" /> Abra desde ese ícono y active los avisos
          </div>
        </div>
      </div>
    );
  }

  if (mode === "denied") {
    return (
      <div className={box}>
        <div className="flex items-start gap-3">
          <BellOff size={18} className="mt-0.5 shrink-0 text-neutral-500" />
          <p className="text-xs text-neutral-600">
            Las notificaciones están bloqueadas en este navegador. Para recibir avisos de pedidos nuevos, permítalas en la configuración del
            navegador para este sitio y vuelva a abrir el enlace.
          </p>
        </div>
      </div>
    );
  }

  // Ya activado: una sola línea pequeña — lo importante de la página son los
  // pedidos por enviar, no este aviso (pedido del usuario 2026-09-23).
  if (mode === "on") {
    return (
      <div className="mb-4">
        <div className="flex items-center gap-1.5 text-xs text-neutral-500">
          <Bell size={13} className="shrink-0 text-emerald-600" />
          <span className="font-medium text-emerald-700">Avisos activados</span>
          <span aria-hidden>·</span>
          <button type="button" onClick={deactivate} disabled={busy} className="underline underline-offset-2 hover:text-neutral-700 disabled:opacity-60">
            {busy ? "Desactivando…" : "Desactivar"}
          </button>
        </div>
        {err && <p className="mt-1 text-xs text-red-600">{err}</p>}
      </div>
    );
  }

  return (
    <div className={`${box} flex flex-wrap items-center gap-3`}>
      <Bell size={18} className="shrink-0 text-neutral-500" />
      <div className="min-w-[200px] flex-1">
        <p className="text-sm font-medium">¿Quiere enterarse al instante de cada pedido nuevo?</p>
        <p className="text-xs text-neutral-500">
          Active los avisos y le llegará una notificación a este celular o computadora cada vez que le pidamos algo, con cuántos pedidos le
          quedan por enviar — sin tener que entrar a revisar.
        </p>
        {err && <p className="mt-1 text-xs text-red-600">{err}</p>}
      </div>
      <button
        type="button"
        onClick={activate}
        disabled={busy}
        className="rounded-md bg-neutral-900 px-4 py-2 text-xs font-medium text-white hover:bg-neutral-800 disabled:opacity-60"
      >
        {busy ? "Activando…" : "Activar avisos"}
      </button>
    </div>
  );
}
