"use client";

import type { SnapshotProduct } from "@/lib/provedixSnapshot";
import { PVX_ASK_EVENT } from "@/components/pvx/PvxChat";

// Contacto en provedix.com: desde 2026-10-16 todo se atiende en el chat de
// Michelle IA (pedido del usuario: "ya no por ningún WhatsApp, todo por
// ahí"). Estos botones abren el chat con la pregunta lista para enviar; lo
// que la IA no resuelve lo responde el equipo en el mismo chat (Michelle, la
// asesora, para Dropi; Yair para Rocket). El clic se sigue anotando para la
// cartera (/api/pvx/contact).

function logContact(code: string): void {
  fetch("/api/pvx/contact", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code }), keepalive: true }).catch(() => null);
}

export function askMichelle(text: string, code: string, source: "producto" | "pagina" = "pagina"): void {
  logContact(code);
  window.dispatchEvent(new CustomEvent(PVX_ASK_EVENT, { detail: { text, source } }));
}

// Botón general (portada, franja naranja y pie): abre el chat sin producto.
export function AskMichelleButton({ className, children, text = "" }: { className: string; children: React.ReactNode; text?: string }) {
  return (
    <button type="button" onClick={() => askMichelle(text, "PORTADA-MICHELLE")} className={className}>
      {children}
    </button>
  );
}

// Botón de un producto: abre el chat con la consulta de ese producto escrita.
export function AskProductButton({
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
  const text = outOfStock ? `¿Cuándo llega más stock de "${p.name}" (ID ${p.code})?` : `Quiero saber más del producto "${p.name}" (ID ${p.code}).`;
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        askMichelle(text, p.code, "producto");
      }}
      className={`pvx-press inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-full bg-[var(--pvx-ink)] ${block ? "w-full" : ""} text-white font-semibold hover:bg-[#25282f] cursor-pointer ${compact ? "px-2.5 py-1.5 text-[12px]" : "px-4 py-2 text-[13.5px]"}`}
    >
      <span aria-hidden className="grid h-4 w-4 place-items-center rounded-full bg-[var(--pvx-orange)] text-[9px] font-black italic">
        M
      </span>
      {compact ? "Preguntar" : outOfStock ? "Preguntar cuándo llega" : "Preguntar a Michelle IA"}
    </button>
  );
}
