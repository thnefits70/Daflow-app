"use client";

import { useEffect, useState } from "react";
import { Bell } from "lucide-react";

// Confirmado 2026-07-28: el usuario pidió explícitamente que estos
// interruptores NO vivan juntos en un panel de Inicio, sino cada uno en el
// lugar real donde ese pendiente/recordatorio se gestiona (ej. este mismo
// componente se cae dentro de Roles de pago, dentro de KPIs Generales,
// etc.) — así cada quien lo prende/apaga justo donde lo ve, sin tener que
// ir a una pantalla de configuración aparte.
//
// Solo se muestra una vez que el permiso del navegador ya está concedido
// (si no, no tiene sentido ofrecer un interruptor de algo que aún no está
// activado en general) y solo si ese tipo realmente le aplica a quien está
// viendo la página — /api/push/preferences ya filtra eso por actor.
export function PushTypeToggle({ type }: { type: string }) {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
    fetch("/api/push/preferences")
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((d: { items: { type: string; enabled: boolean }[] }) => {
        const found = d.items.find((i) => i.type === type);
        setEnabled(found ? found.enabled : null);
      })
      .catch(() => setEnabled(null));
  }, [type]);

  async function toggle() {
    if (enabled === null) return;
    const next = !enabled;
    setSaving(true);
    setEnabled(next);
    await fetch("/api/push/preferences", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type, enabled: next }),
    }).catch(() => null);
    setSaving(false);
  }

  if (enabled === null) return null;

  return (
    <button
      type="button"
      disabled={saving}
      onClick={toggle}
      title={enabled ? "Te llega notificación de esto — clic para desactivar" : "No te llega notificación de esto — clic para activar"}
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold cursor-pointer disabled:opacity-60 shrink-0 ${
        enabled ? "bg-teal/15 border-teal/40 text-teal" : "bg-cloud border-rule text-steel"
      }`}
    >
      <Bell size={12} />
      {enabled ? "Notificarme: Sí" : "Notificarme: No"}
    </button>
  );
}
