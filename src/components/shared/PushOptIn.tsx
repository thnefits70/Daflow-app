"use client";

import { useEffect, useState } from "react";
import { Bell, X, Share, SquarePlus, ChevronRight } from "lucide-react";

const DISMISS_KEY = "daflow_push_dismissed";

function urlBase64ToUint8Array(base64: string) {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const base64Safe = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64Safe);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

// Confirmado 2026-07-28: en iPhone, Safari SOLO expone PushManager cuando el
// sitio ya fue agregado a la pantalla de inicio y se abrió desde ahí — en
// una pestaña normal de Safari, "PushManager" ni siquiera existe en window.
// Sin esta detección, el aviso completo se queda oculto en silencio para
// cualquier iPhone (peor que un botón roto: no se ve nada, sin pista de
// qué hacer). isStandalone cubre tanto el estándar (display-mode) como el
// flag propio de iOS (`navigator.standalone`).
function isIOS() {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  const isAppleTouch = /iPad|iPhone|iPod/.test(ua);
  const isIPadOsDesktopUa = navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
  return isAppleTouch || isIPadOsDesktopUa;
}

function isStandalone() {
  if (typeof window === "undefined") return false;
  const nav = window.navigator as Navigator & { standalone?: boolean };
  return window.matchMedia("(display-mode: standalone)").matches || nav.standalone === true;
}

// Confirmado 2026-07-28: solo se muestra a quien alguna vez podría tener
// algo en "Pendientes" (admin o líder de área — ver /api/push/eligible), y
// solo mientras el navegador soporte Push y todavía no se haya dado ni
// negado el permiso. Una vez que la persona activa (o dice "ahora no"), no
// vuelve a insistir en esa misma sesión de navegador.
export function PushOptIn() {
  const [mode, setMode] = useState<"none" | "activate" | "ios-install">("none");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (localStorage.getItem(DISMISS_KEY)) return;

    const iOS = isIOS();
    const standalone = isStandalone();

    // Confirmado 2026-07-30 (bug real: el banner nunca aparecía en un
    // iPhone con Chrome, ni el botón de activar ni el de instalar) — en iOS,
    // "Notification" en window puede no existir todavía fuera de modo
    // standalone, así que hay que revisar iOS ANTES de asumir "no soportado"
    // — esa ausencia es justo la razón por la que hay que instalarlo
    // primero, no una señal de que el dispositivo no sirve. PushManager
    // tampoco existe todavía — hay que guiar a "Añadir a pantalla de
    // inicio" primero, no intentar activar.
    if (iOS && !standalone) {
      fetch("/api/push/eligible")
        .then((r) => (r.ok ? r.json() : { eligible: false }))
        .then((d) => setMode(d.eligible ? "ios-install" : "none"))
        .catch(() => setMode("none"));
      return;
    }

    if (!("Notification" in window)) return;
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) return;
    if (Notification.permission !== "default") return;

    fetch("/api/push/eligible")
      .then((r) => (r.ok ? r.json() : { eligible: false }))
      .then((d) => setMode(d.eligible ? "activate" : "none"))
      .catch(() => setMode("none"));
  }, []);

  async function activate() {
    setBusy(true);
    setErr("");
    try {
      const registration = await navigator.serviceWorker.register("/sw.js");
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setErr("No se activaron — el permiso quedó denegado.");
        setMode("none");
        return;
      }
      const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
      if (!publicKey) throw new Error("Falta configurar la clave pública.");
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });
      await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(subscription.toJSON()),
      });
      setMode("none");
    } catch {
      setErr("No se pudo activar. Intenta de nuevo.");
    } finally {
      setBusy(false);
    }
  }

  function dismiss() {
    localStorage.setItem(DISMISS_KEY, "1");
    setMode("none");
  }

  if (mode === "none") return null;

  if (mode === "ios-install") {
    return (
      <div className="bg-surface border border-rule rounded-lg p-4 mb-6">
        <div className="flex items-start gap-3.5">
          <div className="w-10 h-10 rounded-md bg-teal/15 flex items-center justify-center shrink-0">
            <Bell size={18} className="text-teal" />
          </div>
          <div className="flex-1 min-w-[220px]">
            <div className="text-[13.5px] font-bold mb-0.5">Activa las notificaciones de DAFLOW</div>
            <div className="text-[12px] text-steel">
              En iPhone hay que hacer esto una sola vez, desde Safari, antes de poder activarlas:
            </div>
          </div>
          <button type="button" onClick={dismiss} className="p-2 text-steel hover:text-ink cursor-pointer shrink-0" title="Ahora no">
            <X size={15} />
          </button>
        </div>
        <div className="flex flex-col sm:flex-row gap-2 mt-3">
          <div className="flex-1 flex items-center gap-2 bg-cloud rounded-md px-3 py-2 text-[11.5px]">
            <Share size={14} className="text-blue shrink-0" />
            Toca compartir <ChevronRight size={12} className="text-steel shrink-0" />
          </div>
          <div className="flex-1 flex items-center gap-2 bg-cloud rounded-md px-3 py-2 text-[11.5px]">
            <SquarePlus size={14} className="text-blue shrink-0" />
            "Añadir a pantalla de inicio" <ChevronRight size={12} className="text-steel shrink-0" />
          </div>
          <div className="flex-1 flex items-center gap-2 bg-cloud rounded-md px-3 py-2 text-[11.5px]">
            <Bell size={14} className="text-blue shrink-0" />
            Abre DAFLOW desde ese ícono y activa ahí
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3.5 flex-wrap bg-surface border border-rule rounded-lg p-4 mb-6">
      <div className="w-10 h-10 rounded-md bg-teal/15 flex items-center justify-center shrink-0">
        <Bell size={18} className="text-teal" />
      </div>
      <div className="flex-1 min-w-[220px]">
        <div className="text-[13.5px] font-bold mb-0.5">Activa las notificaciones de DAFLOW</div>
        <div className="text-[12px] text-steel">Te avisamos de tus pendientes aunque no tengas la plataforma abierta.</div>
        {err && <div className="text-[11.5px] text-red mt-1">{err}</div>}
      </div>
      <button
        type="button"
        disabled={busy}
        onClick={activate}
        className="rounded-md bg-teal text-navy font-bold text-[12.5px] px-4 py-2 cursor-pointer disabled:opacity-60"
      >
        {busy ? "Activando…" : "Activar"}
      </button>
      <button
        type="button"
        onClick={dismiss}
        className="p-2 text-steel hover:text-ink cursor-pointer"
        title="Ahora no"
      >
        <X size={15} />
      </button>
    </div>
  );
}
