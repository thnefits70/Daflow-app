"use client";

import { useEffect, useState } from "react";
import { Bell, X } from "lucide-react";

const DISMISS_KEY = "daflow_push_dismissed";

function urlBase64ToUint8Array(base64: string) {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const base64Safe = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64Safe);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

// Confirmado 2026-07-28: solo se muestra a quien alguna vez podría tener
// algo en "Pendientes" (admin o líder de área — ver /api/push/eligible), y
// solo mientras el navegador soporte Push y todavía no se haya dado ni
// negado el permiso. Una vez que la persona activa (o dice "ahora no"), no
// vuelve a insistir en esa misma sesión de navegador.
export function PushOptIn() {
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return;
    if (Notification.permission !== "default") return;
    if (localStorage.getItem(DISMISS_KEY)) return;

    fetch("/api/push/eligible")
      .then((r) => (r.ok ? r.json() : { eligible: false }))
      .then((d) => setShow(!!d.eligible))
      .catch(() => setShow(false));
  }, []);

  async function activate() {
    setBusy(true);
    setErr("");
    try {
      const registration = await navigator.serviceWorker.register("/sw.js");
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setErr("No se activaron — el permiso quedó denegado.");
        setShow(false);
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
      setShow(false);
    } catch {
      setErr("No se pudo activar. Intenta de nuevo.");
    } finally {
      setBusy(false);
    }
  }

  function dismiss() {
    localStorage.setItem(DISMISS_KEY, "1");
    setShow(false);
  }

  if (!show) return null;

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
