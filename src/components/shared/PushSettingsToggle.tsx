"use client";

import { useEffect, useState } from "react";
import { Bell, BellOff, Info } from "lucide-react";

function urlBase64ToUint8Array(base64: string) {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const base64Safe = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64Safe);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

function isIOS() {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  return /iPad|iPhone|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}
function isStandalone() {
  if (typeof window === "undefined") return false;
  const nav = window.navigator as Navigator & { standalone?: boolean };
  return window.matchMedia("(display-mode: standalone)").matches || nav.standalone === true;
}

type Status = "checking" | "unsupported" | "ios-need-install" | "denied" | "on" | "off";

// Confirmado 2026-07-29: a diferencia de PushOptIn (el banner que se oculta
// para siempre en cuanto alguien lo cierra una vez — localStorage
// "daflow_push_dismissed"), este control vive de forma PERMANENTE en el pie
// del sidebar, en TODAS las pantallas, y siempre refleja el estado real del
// navegador — así alguien que cerró el banner sin querer, o cuya laptop
// nunca llegó a activarse, tiene un lugar fijo al que volver, en vez de
// quedar sin ninguna forma de reintentarlo.
export function PushSettingsToggle() {
  const [status, setStatus] = useState<Status>("checking");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    async function check() {
      if (typeof window === "undefined" || !("Notification" in window)) {
        setStatus("unsupported");
        return;
      }
      if (isIOS() && !isStandalone()) {
        setStatus("ios-need-install");
        return;
      }
      if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
        setStatus("unsupported");
        return;
      }
      if (Notification.permission === "denied") {
        setStatus("denied");
        return;
      }
      const registration = await navigator.serviceWorker.getRegistration("/sw.js");
      const sub = await registration?.pushManager.getSubscription();
      setStatus(sub ? "on" : "off");
    }
    check();
  }, []);

  async function turnOn() {
    setBusy(true);
    try {
      const registration = await navigator.serviceWorker.register("/sw.js");
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setStatus(permission === "denied" ? "denied" : "off");
        return;
      }
      const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
      if (!publicKey) return;
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });
      await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(subscription.toJSON()),
      });
      setStatus("on");
    } catch {
      // se queda en el estado anterior — el botón sigue disponible para reintentar
    } finally {
      setBusy(false);
    }
  }

  async function turnOff() {
    setBusy(true);
    try {
      const registration = await navigator.serviceWorker.getRegistration("/sw.js");
      const sub = await registration?.pushManager.getSubscription();
      if (sub) {
        await fetch("/api/push/subscribe", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        });
        await sub.unsubscribe();
      }
      setStatus("off");
    } catch {
      // no-op — se puede reintentar
    } finally {
      setBusy(false);
    }
  }

  if (status === "checking" || status === "unsupported") return null;

  if (status === "ios-need-install") {
    return (
      <div className="text-[11px] text-[#8C99A6] leading-snug">
        <div className="flex items-center gap-1.5 mb-0.5"><BellOff size={12} /> Notificaciones</div>
        Añade DAFLOW a tu pantalla de inicio y ábrelo desde ahí para poder activarlas.
      </div>
    );
  }

  if (status === "denied") {
    return (
      <div className="text-[11px] text-[#8C99A6] leading-snug">
        <div className="flex items-center gap-1.5 mb-0.5"><BellOff size={12} /> Notificaciones bloqueadas</div>
        Se bloquearon en el navegador — actívalas desde su configuración de sitio para volver a intentarlo aquí.
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1.5">
      <button
        type="button"
        disabled={busy}
        onClick={status === "on" ? turnOff : turnOn}
        className="flex items-center gap-2 text-[#C9CFC5] hover:text-white text-[12.5px] cursor-pointer disabled:opacity-60"
      >
        {status === "on" ? <Bell size={14} /> : <BellOff size={14} />}
        Notificaciones: {busy ? "..." : status === "on" ? "activadas" : "desactivadas"}
      </button>

      <div className="relative group shrink-0">
        <Info size={13} className="text-[#8C99A6] hover:text-white cursor-help" />
        <div className="hidden group-hover:block absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-60 rounded-md bg-[#0c1524] border border-white/10 p-2.5 text-[11px] leading-snug text-[#C9CFC5] shadow-lg z-50">
          Te avisa de tus pendientes aunque no tengas DAFLOW abierto — en el navegador o el celular, como cualquier otra notificación.
          <br /><br />
          Es <b className="text-white">por dispositivo</b>: activarlo aquí solo cubre este navegador/celular. Si quieres recibirlas también en otro dispositivo, hay que activarlo ahí también, con este mismo botón.
          <br /><br />
          Puedes desactivarlo cuando quieras — deja de avisarte solo en este dispositivo, sin afectar a nadie más.
        </div>
      </div>
    </div>
  );
}
