"use client";

import { useEffect, useRef, useState } from "react";

// SKU de Rocket en la tarjeta del catálogo (pedido 2026-10-12): es largo y
// deformaba la tarjeta, así que va escondido detrás de un botón chico; al
// tocarlo se abre un globito encima (no empuja nada) con el SKU y "Copiar".
// El globito ocupa el ancho de la tarjeta para no salirse en celular.
export function PvxRocketSku({ sku }: { sku: string }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);

  return (
    <div ref={ref} onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={`inline-flex w-full items-center justify-center gap-1 rounded-md border px-2 py-[3px] text-[11px] font-semibold cursor-pointer ${open ? "border-[#16181d] bg-[#16181d] text-white" : "border-[#d9d6cf] bg-white text-[#16181d] hover:border-[#ff5a1f]"}`}
      >
        Ver SKU de Rocket <span className="text-[9px]">{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <div className="absolute z-10 bottom-full mb-1.5 left-0 right-0 rounded-lg border border-[#e6e2da] bg-white p-2 shadow-lg">
          <div className="text-[10px] font-bold uppercase tracking-wide text-[#8a8f98]">SKU en Rocket</div>
          <div className="mt-0.5 font-mono text-[12px] break-all text-[#16181d]">{sku}</div>
          <button
            type="button"
            onClick={() => {
              navigator.clipboard?.writeText(sku).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1800);
              });
            }}
            className="mt-1.5 w-full rounded-md bg-[#ff5a1f] text-white text-[11.5px] font-semibold py-1 cursor-pointer hover:bg-[#e64a12]"
          >
            {copied ? "¡Copiado!" : "Copiar SKU"}
          </button>
        </div>
      )}
    </div>
  );
}
