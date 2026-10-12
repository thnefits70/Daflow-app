"use client";

import type { SnapshotProduct } from "@/lib/provedixSnapshot";

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

export function WhatsAppButton({
  p,
  outOfStock = false,
  compact = false,
}: {
  p: { code: string; name: string; brand: SnapshotProduct["brand"] };
  outOfStock?: boolean;
  compact?: boolean;
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
      className={`inline-flex items-center justify-center gap-1.5 rounded-md bg-[#1faa53] text-white font-semibold hover:bg-[#178a43] ${compact ? "px-2 py-1 text-[11px]" : "px-3 py-1.5 text-[12.5px]"}`}
    >
      <svg viewBox="0 0 24 24" className={compact ? "w-3.5 h-3.5" : "w-4 h-4"} fill="currentColor" aria-hidden>
        <path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2Zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8s-.4-.1-.6.1-.7.8-.8 1-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.3-.4.3-.4.7-1.3.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.7 11.8 11.8 0 0 0 4.5 4c1.7.7 2.3.8 3.2.6a2.7 2.7 0 0 0 1.8-1.2 2.2 2.2 0 0 0 .2-1.2c-.1-.1-.3-.2-.5-.3Z" />
      </svg>
      {compact ? "Asesor" : outOfStock ? "Preguntar al asesor cuándo llega" : "Consultar con el asesor"}
    </a>
  );
}
