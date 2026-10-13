"use client";

import { useEffect, useRef, useState } from "react";
import type { SnapshotProduct } from "@/lib/provedixSnapshot";
import { IconWhatsApp } from "@/components/pvx/PvxIcons";

// Asesores de provedix.com (corregido por el usuario 2026-10-13): Michelle
// atiende Provedix e Importadora Damián (productos de Dropi) y Yair atiende
// a quienes venden en Rocket. Jariel ya no sale en la página. Nada en los
// mensajes menciona otra cosa que Provedix.
export const ADVISORS = {
  dropi: { name: "Michelle", phone: "593983809912", label: "Productos de Provedix e Importadora Damián", platform: "Dropi" },
  rocket: { name: "Yair", phone: "593999935257", label: "Si vendes nuestros productos en Rocket", platform: "Rocket" },
} as const;
export type AdvisorKey = keyof typeof ADVISORS;

export function whatsappUrl(p: { code: string; name: string; brand: SnapshotProduct["brand"] }, outOfStock = false, advisor: AdvisorKey = "dropi"): string {
  const text = outOfStock
    ? `Hola, vi en Provedix el producto "${p.name}" (ID ${p.code}). ¿Cuándo llega más stock?`
    : `Hola, vi en Provedix el producto "${p.name}" (ID ${p.code}) y quiero consultar.`;
  return `https://wa.me/${ADVISORS[advisor].phone}?text=${encodeURIComponent(text)}`;
}

// Botones generales (portada, franja naranja y pie): sin producto. El clic se
// anota como "PORTADA-DROPI" o "PORTADA-ROCKET".
function generalUrl(k: AdvisorKey): string {
  const text = k === "rocket" ? "Hola, vi la página de Provedix y quiero vender sus productos en Rocket." : "Hola, vi la página de Provedix y quiero empezar a vender sus productos en Dropi.";
  return `https://wa.me/${ADVISORS[k].phone}?text=${encodeURIComponent(text)}`;
}

function logContact(code: string): void {
  fetch("/api/pvx/contact", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code }), keepalive: true }).catch(() => null);
}

// Botón que abre un menú para elegir el asesor según dónde vende la persona.
export function AdvisorPicker({ className, children, up = false, dark = false, alignRight = false }: { className: string; children: React.ReactNode; up?: boolean; dark?: boolean; alignRight?: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);
  return (
    <div ref={ref} className="relative inline-block">
      <button type="button" aria-expanded={open} aria-haspopup="menu" onClick={() => setOpen(!open)} className={className}>
        {children}
      </button>
      {open && (
        <div
          role="menu"
          className={`pvx-pop absolute ${alignRight ? "right-0" : "left-0"} z-40 w-[min(320px,calc(100vw-32px))] overflow-hidden rounded-3xl p-2 text-left shadow-[0_24px_60px_-20px_rgb(0_0_0/0.55)] ${up ? "bottom-full mb-2" : "top-full mt-2"} ${dark ? "bg-[var(--pvx-night-2)] text-white" : "bg-white text-[var(--pvx-ink)]"} max-sm:fixed max-sm:inset-x-3 max-sm:top-auto max-sm:bottom-3 max-sm:right-3 max-sm:left-3 max-sm:m-0 max-sm:w-auto max-sm:z-50`}
        >
          <p className={`px-3 pt-2 pb-1 text-[13px] font-semibold ${dark ? "text-white/60" : "text-[var(--pvx-ink-3)]"}`}>¿Dónde vendes?</p>
          {(Object.keys(ADVISORS) as AdvisorKey[]).map((k) => (
            <a
              key={k}
              role="menuitem"
              href={generalUrl(k)}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => {
                logContact(`PORTADA-${k.toUpperCase()}`);
                setOpen(false);
              }}
              className={`flex items-center gap-3 rounded-2xl px-3 py-3 ${dark ? "hover:bg-white/10" : "hover:bg-[var(--pvx-paper-2)]"}`}
            >
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[#138a45] text-white">
                <IconWhatsApp className="w-5 h-5" />
              </span>
              <span className="min-w-0">
                <span className="block text-[15px] font-bold">
                  {ADVISORS[k].platform} · {ADVISORS[k].name}
                </span>
                <span className={`block truncate text-[13px] ${dark ? "text-white/60" : "text-[var(--pvx-ink-2)]"}`}>{ADVISORS[k].label}</span>
              </span>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

export function WhatsAppButton({
  p,
  outOfStock = false,
  compact = false,
  block = false,
  advisor = "dropi",
}: {
  p: { code: string; name: string; brand: SnapshotProduct["brand"] };
  outOfStock?: boolean;
  compact?: boolean;
  block?: boolean;
  advisor?: AdvisorKey;
}) {
  return (
    <a
      href={whatsappUrl(p, outOfStock, advisor)}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => {
        e.stopPropagation();
        // Se cuenta el clic sin frenar la apertura de WhatsApp.
        fetch("/api/pvx/contact", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: p.code }), keepalive: true }).catch(() => null);
      }}
      className={`pvx-press inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-full bg-[#138a45] ${block ? "w-full" : ""} text-white font-semibold hover:bg-[#0f7239] ${compact ? "px-2.5 py-1.5 text-[12px]" : "px-4 py-2 text-[13.5px]"}`}
    >
      <IconWhatsApp className={compact ? "w-3.5 h-3.5" : "w-4 h-4"} />
      {compact ? "Asesor" : advisor === "rocket" ? `Asesor de Rocket · ${ADVISORS.rocket.name}` : outOfStock ? "Preguntar al asesor cuándo llega" : "Consultar con el asesor"}
    </a>
  );
}
