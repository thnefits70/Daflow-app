"use client";

import { useState } from "react";
import { IconCopy, IconWhatsApp } from "@/components/pvx/PvxIcons";

// Compartir una herramienta de provedix.com (2026-10-15): copiar el enlace o
// mandarlo por WhatsApp, para que más dropshippers conozcan la página.
export const PVX_SHARE_URLS = {
  calculadora: "https://provedix.com/calculadora",
  michelle: "https://provedix.com/michelle",
} as const;

export function PvxShare({
  url,
  message,
  dark = false,
  compact = false,
}: {
  url: string;
  message: string;
  dark?: boolean;
  compact?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      // Navegadores que no dejan usar el portapapeles: copia "a la antigua".
      const t = document.createElement("textarea");
      t.value = url;
      t.setAttribute("readonly", "");
      t.style.position = "fixed";
      t.style.opacity = "0";
      document.body.appendChild(t);
      t.select();
      document.execCommand("copy");
      t.remove();
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }
  const base = dark
    ? "bg-white/10 text-white ring-1 ring-white/20 hover:bg-white/20"
    : "bg-white text-[var(--pvx-ink)] ring-1 ring-[var(--pvx-paper-3)] hover:ring-[var(--pvx-orange)]";
  const size = compact
    ? "px-3 py-1.5 text-[12.5px]"
    : "px-4 py-2.5 text-[13.5px]";
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={copy}
        aria-live="polite"
        className={`pvx-press inline-flex items-center gap-1.5 rounded-full font-bold cursor-pointer ${base} ${size}`}
      >
        <IconCopy className="w-4 h-4" />{" "}
        {copied ? "¡Enlace copiado!" : "Copiar enlace"}
      </button>
      <a
        href={`https://wa.me/?text=${encodeURIComponent(`${message} ${url}`)}`}
        target="_blank"
        rel="noopener noreferrer"
        className={`pvx-press inline-flex items-center gap-1.5 rounded-full font-bold ${base} ${size}`}
      >
        <IconWhatsApp className="w-4 h-4 text-[#25d366]" /> Compartir
      </a>
    </div>
  );
}
