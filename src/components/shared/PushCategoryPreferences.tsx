"use client";

import { useEffect, useState } from "react";

type PrefItem = { type: string; label: string; enabled: boolean };

// Confirmado 2026-07-28: cada persona elige qué tipos de pendiente quiere
// que le lleguen como notificación push — todo activado por defecto. Solo
// se muestra una vez que ya activó el permiso del navegador (antes de eso
// no tiene sentido configurar nada).
export function PushCategoryPreferences() {
  const [items, setItems] = useState<PrefItem[] | null>(null);
  const [saving, setSaving] = useState<string | null>(null);

  useEffect(() => {
    if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
    fetch("/api/push/preferences")
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((d) => setItems(d.items))
      .catch(() => setItems([]));
  }, []);

  async function toggle(type: string, enabled: boolean) {
    setSaving(type);
    setItems((prev) => prev?.map((i) => (i.type === type ? { ...i, enabled } : i)) ?? prev);
    await fetch("/api/push/preferences", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type, enabled }),
    }).catch(() => null);
    setSaving(null);
  }

  if (!items || items.length === 0) return null;

  return (
    <div className="bg-surface border border-rule rounded-lg p-4 mb-6">
      <div className="text-[12.5px] font-bold mb-0.5">Qué te queremos notificar</div>
      <div className="text-[11px] text-steel mb-3">
        Elige qué tipos de pendiente te avisan por notificación — el resto sigue viéndose igual dentro de DAFLOW.
      </div>
      <div className="flex flex-col gap-1.5">
        {items.map((item) => (
          <div key={item.type} className="flex items-center justify-between gap-3 px-1 py-1">
            <span className="text-[12.5px]">{item.label}</span>
            <button
              type="button"
              disabled={saving === item.type}
              onClick={() => toggle(item.type, !item.enabled)}
              className={`relative w-9 h-5 rounded-full shrink-0 cursor-pointer transition-colors disabled:opacity-60 ${
                item.enabled ? "bg-teal" : "bg-rule"
              }`}
              aria-pressed={item.enabled}
              title={item.enabled ? "Activado" : "Desactivado"}
            >
              <span
                className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
                  item.enabled ? "translate-x-[18px]" : "translate-x-0.5"
                }`}
              />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
