"use client";

import { useState } from "react";
import { Copy, Check } from "lucide-react";

// Confirmado 2026-09-30, pedido del usuario: Heidy ya no escribe el precio de
// Dropi a mano en DAFLOW (era doble trabajo). Lo copia con un botón y lo pega
// en Dropi, así no se equivoca al tipear. El recordatorio sale siempre.
export function CopyDropiPrice({ price, label = "Precio Dropi" }: { price: number; label?: string }) {
  const [copied, setCopied] = useState(false);
  const text = price.toFixed(2);
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Sin permiso de portapapeles: el número igual se ve para copiarlo a mano.
    }
  }
  return (
    <div className="rounded border border-rule bg-inset px-3 py-2 mb-2">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[12px] text-steel">{label}:</span>
        <b className="text-[15px] text-ink">${text}</b>
        <button type="button" onClick={copy} className="flex items-center gap-1 rounded border border-blue px-2 py-0.5 text-[11.5px] font-semibold text-blue cursor-pointer">
          {copied ? <Check size={12} /> : <Copy size={12} />} {copied ? "Copiado" : "Copiar"}
        </button>
      </div>
      <div className="text-[11px] text-steel mt-1">Pon exactamente este precio en Dropi. Puedes poner uno mayor por la competencia, nunca uno menor.</div>
    </div>
  );
}
