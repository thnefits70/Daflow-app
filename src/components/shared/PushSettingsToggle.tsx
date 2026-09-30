"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Bell, BellOff, Info, X } from "lucide-react";

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

const MANUAL_OFF_KEY = "daflow_push_manual_off";
function readManualOff() {
  try { return localStorage.getItem(MANUAL_OFF_KEY) === "1"; } catch { return false; }
}
function writeManualOff(off: boolean) {
  try { if (off) localStorage.setItem(MANUAL_OFF_KEY, "1"); else localStorage.removeItem(MANUAL_OFF_KEY); } catch { /* sin almacenamiento: no pasa nada */ }
}

async function postSubscription(sub: PushSubscription, extra: { stillSilentAfterReset?: boolean } = {}): Promise<{ ok: boolean; silent: boolean }> {
  const res = await fetch("/api/push/subscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...sub.toJSON(), tracking: true, ...extra }),
  });
  const data = res.ok ? await res.json().catch(() => ({})) : {};
  return { ok: res.ok, silent: data?.silent === true };
}

async function subscribeFresh(registration: ServiceWorkerRegistration): Promise<PushSubscription | null> {
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  if (!publicKey) return null;
  return registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) });
}

// 2026-09-30: si DAFLOW detectó que este celular no muestra los avisos, lo
// primero es volver a registrarlo desde cero (sin que nadie haga nada). Si
// ya se hizo en los últimos RESET_WINDOW_MS y sigue igual, el problema es un
// ajuste del celular: se muestran los pasos y se avisa al admin.
const RESET_KEY = "daflow_push_auto_reset_at";
const RESET_WINDOW_MS = 7 * 24 * 3600 * 1000;
function readResetAt() {
  try { return Number(localStorage.getItem(RESET_KEY) || 0); } catch { return 0; }
}
function writeResetAt() {
  try { localStorage.setItem(RESET_KEY, String(Date.now())); } catch { /* sin almacenamiento */ }
}

// Una sola vez por carga de página, aunque el menú se dibuje dos veces.
let autoRepairRun: Promise<{ ok: boolean; silent: boolean }> | null = null;

async function autoRepair(existing: PushSubscription | null): Promise<{ ok: boolean; silent: boolean }> {
  const registration = await navigator.serviceWorker.register("/sw.js");
  await registration.update().catch(() => null);
  // Unos segundos para que los avisos que estaban en cola lleguen y el
  // celular alcance a responder antes de revisar si está "mudo".
  await new Promise((r) => setTimeout(r, 8000));
  let sub = existing ?? (await subscribeFresh(registration));
  if (!sub) return { ok: false, silent: false };
  const first = await postSubscription(sub);
  if (!first.silent) return first;

  if (Date.now() - readResetAt() > RESET_WINDOW_MS) {
    await fetch("/api/push/subscribe", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ endpoint: sub.endpoint }),
    }).catch(() => null);
    await sub.unsubscribe().catch(() => null);
    sub = await subscribeFresh(registration);
    if (!sub) return { ok: false, silent: false };
    writeResetAt();
    return postSubscription(sub);
  }
  return postSubscription(sub, { stillSilentAfterReset: true });
}

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
  const [silent, setSilent] = useState(false);
  const [silentClosed, setSilentClosed] = useState(false);

  useEffect(() => {
    async function check() {
      if (typeof window === "undefined") {
        setStatus("unsupported");
        return;
      }
      // Confirmado 2026-07-30 (bug real, reportado por el usuario — en un
      // iPhone no aparecía NADA, ni el interruptor ni el aviso de instalar):
      // en iOS, "Notification" en window puede no existir todavía fuera de
      // modo standalone — hay que revisar iOS ANTES de asumir "no soportado",
      // porque justamente esa ausencia es la razón por la que hay que
      // instalarlo primero, no una señal de que el dispositivo no sirve.
      if (isIOS() && !isStandalone()) {
        setStatus("ios-need-install");
        return;
      }
      if (!("Notification" in window) || !("serviceWorker" in navigator) || !("PushManager" in window)) {
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
      // 2026-09-30 (Joel no recibió el aviso de bloque asignado): cada vez que
      // alguien abre DAFLOW se renueva solo el registro de este celular, sin
      // que nadie toque nada — si el celular perdió la suscripción pero el
      // permiso sigue dado, se vuelve a suscribir; si la tiene, se reenvía al
      // servidor para que quede al día y a nombre de quien entró. No se hace
      // si la persona la apagó a propósito con este botón.
      if (Notification.permission === "granted" && !readManualOff()) {
        autoRepairRun ??= autoRepair(sub ?? null);
        autoRepairRun
          .then((r) => {
            if (r.ok) setStatus("on");
            setSilent(r.silent);
          })
          .catch(() => null);
      }
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
        body: JSON.stringify({ ...subscription.toJSON(), tracking: true }),
      });
      writeManualOff(false);
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
      writeManualOff(true);
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
      {silent && !silentClosed && createPortal(<SilentDeviceNotice onClose={() => setSilentClosed(true)} />, document.body)}
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

// 2026-09-30: aparece sola, sin que nadie la pida, en el celular que DAFLOW
// detectó que no muestra los avisos (ni después de volver a registrarlo).
// Una página web no puede cambiar los ajustes del celular — solo su dueño —
// así que aquí van los pasos exactos. Vuelve a salir en cada apertura hasta
// que el celular empiece a mostrar los avisos; ahí desaparece sola.
const IOS_STEPS = [
  "Abre Ajustes → Notificaciones → DAFLOW.",
  "Activa “Permitir notificaciones” y “Pantalla bloqueada”.",
  "Revisa que no tengas activado un modo Concentración / No molestar.",
];
const ANDROID_STEPS = [
  "Mantén presionado el ícono de Chrome → “Información de la app”.",
  "Entra a “Ahorro de batería” (o “Batería”) → elige “Sin restricciones”.",
  "Si ves “Inicio automático”, actívalo.",
  "Entra a “Notificaciones” y activa todo.",
];

function SilentDeviceNotice({ onClose }: { onClose: () => void }) {
  const steps = isIOS() ? IOS_STEPS : ANDROID_STEPS;
  return (
    <div className="fixed inset-x-3 bottom-24 z-[100] mx-auto max-w-md rounded-lg border border-rule bg-surface text-ink p-4 shadow-2xl">
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-md bg-red/15 flex items-center justify-center shrink-0">
          <BellOff size={17} className="text-red" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[13.5px] font-bold mb-0.5">Tu celular no te está mostrando los avisos de DAFLOW</div>
          <div className="text-[12px] text-steel mb-2">DAFLOW te los manda, pero el celular los frena. Haz esto una sola vez:</div>
          <ol className="list-decimal pl-4 text-[12px] space-y-1">
            {steps.map((s) => <li key={s}>{s}</li>)}
          </ol>
          <div className="text-[11px] text-steel mt-2">Cuando el celular vuelva a mostrar los avisos, este mensaje desaparece solo.</div>
        </div>
        <button type="button" onClick={onClose} className="p-1.5 text-steel hover:text-ink cursor-pointer shrink-0" title="Cerrar por ahora">
          <X size={15} />
        </button>
      </div>
    </div>
  );
}
