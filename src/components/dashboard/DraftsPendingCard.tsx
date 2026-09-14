"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { FileEdit, X } from "lucide-react";

type DraftItem = { id: string; formKey: string; label: string; resumeUrl: string; updatedAt: string };

function timeAgo(iso: string) {
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 60) return mins <= 1 ? "hace un momento" : `hace ${mins} min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `hace ${hours} h`;
  const days = Math.floor(hours / 24);
  return `hace ${days} día${days === 1 ? "" : "s"}`;
}

// Pedido explícito del usuario 2026-09-14: si alguien dejó una gestión a
// medias (ver useFormDraft) y se olvidó de volver, que no se quede
// "perdida" — se lo recuerda en Inicio con opción de continuar o descartar.
// Solo ve sus propios borradores (/api/form-drafts/mine, scoped a
// session.user.id).
export function DraftsPendingCard() {
  const [items, setItems] = useState<DraftItem[] | null>(null);
  const [discarding, setDiscarding] = useState<string | null>(null);

  function load() {
    fetch("/api/form-drafts/mine")
      .then((r) => (r.ok ? r.json() : []))
      .then(setItems)
      .catch(() => setItems([]));
  }
  useEffect(load, []);

  async function discard(formKey: string) {
    setDiscarding(formKey);
    try {
      await fetch(`/api/form-drafts?key=${encodeURIComponent(formKey)}`, { method: "DELETE" });
      load();
    } finally {
      setDiscarding(null);
    }
  }

  if (!items || items.length === 0) return null;

  return (
    <div className="bg-surface border rounded-lg p-4 mb-6" style={{ borderColor: "rgba(217,164,65,.35)" }}>
      <div className="flex items-center gap-2 text-[13px] font-bold mb-0.5">
        <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: "#D9A441", boxShadow: "0 0 0 3px rgba(217,164,65,.18)" }} />
        Tienes gestiones sin terminar
      </div>
      <div className="text-[11px] text-steel mb-3">Se guardaron solas — continúalas donde las dejaste, o descártalas si ya no aplican.</div>

      <div className="flex flex-col gap-1.5">
        {items.map((item) => (
          <div key={item.id} className="flex items-center gap-2.5 rounded-md px-3 py-2.5 bg-cloud">
            <span className="w-5 flex items-center justify-center shrink-0 text-steel">
              <FileEdit size={14} />
            </span>
            <div className="flex-1 min-w-0">
              <div className="text-[12.5px] font-semibold">{item.label}</div>
              <div className="text-[10.5px] text-steel mt-0.5">{timeAgo(item.updatedAt)}</div>
            </div>
            <button
              type="button"
              disabled={discarding === item.formKey}
              title="Descartar esta gestión"
              className="text-steel hover:text-red cursor-pointer disabled:opacity-50 shrink-0"
              onClick={() => discard(item.formKey)}
            >
              <X size={14} />
            </button>
            <Link href={item.resumeUrl} className="text-[11px] font-bold text-blue shrink-0">
              Continuar →
            </Link>
          </div>
        ))}
      </div>
    </div>
  );
}
