"use client";

import type { SnapshotProduct } from "@/lib/provedixSnapshot";
import { IconWhatsApp } from "@/components/pvx/PvxIcons";

// Asesor por marca (pedido del usuario 2026-10-12): los IDs de Provedix van
// a Jariel y los de Importadora Damián a Michelle, por WhatsApp, con el
// producto ya escrito en el mensaje. Nada en el mensaje menciona otra cosa
// que Provedix.
const ADVISOR_WHATSAPP: Record<SnapshotProduct["brand"], string> = {
  MKT_PROVEDIX: "593963744396",
  MKT_DAMIAN: "593983809912",
};

export function whatsappUrl(p: { code: string; name: string; brand: SnapshotProduct["brand"] }, outOfStock = false): string {
  const text = outOfStock
    ? `Hola, vi en Provedix el producto "${p.name}" (ID ${p.code}). ¿Cuándo llega más stock?`
    : `Hola, vi en Provedix el producto "${p.name}" (ID ${p.code}) y quiero consultar.`;
  return `https://wa.me/${ADVISOR_WHATSAPP[p.brand]}?text=${encodeURIComponent(text)}`;
}

// Botón de la portada (rediseño 2026-10-13), sin producto: va al asesor de
// Provedix. El clic se anota con el código "PORTADA".
export const GENERAL_WHATSAPP_URL = `https://wa.me/${ADVISOR_WHATSAPP.MKT_PROVEDIX}?text=${encodeURIComponent("Hola, vi la página de Provedix y quiero empezar a vender sus productos.")}`;

export function logGeneralContact(): void {
  fetch("/api/pvx/contact", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: "PORTADA" }), keepalive: true }).catch(() => null);
}

export function WhatsAppButton({
  p,
  outOfStock = false,
  compact = false,
  block = false,
}: {
  p: { code: string; name: string; brand: SnapshotProduct["brand"] };
  outOfStock?: boolean;
  compact?: boolean;
  block?: boolean;
}) {
  return (
    <a
      href={whatsappUrl(p, outOfStock)}
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
      {compact ? "Asesor" : outOfStock ? "Preguntar al asesor cuándo llega" : "Consultar con el asesor"}
    </a>
  );
}
