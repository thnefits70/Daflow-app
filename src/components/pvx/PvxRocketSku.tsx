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
        className={`pvx-press inline-flex w-full items-center justify-center gap-1 rounded-full px-2 py-1.5 text-[12.5px] font-bold cursor-pointer ${open ? "bg-[#111214] text-white" : "bg-white text-[#111214] hover:bg-[#FFF1E8]"}`}
      >
        Ver SKU de Rocket <span className="text-[9px]">{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <div className="pvx-pop absolute z-10 bottom-full mb-1.5 left-0 right-0 rounded-2xl bg-white p-2.5 shadow-[0_16px_40px_-12px_rgb(0_0_0/0.35)]">
          <div className="text-[12px] font-bold text-[#6B717B]">SKU en Rocket</div>
          <div className="pvx-num mt-0.5 text-[12.5px] font-bold break-all text-[#111214]">{sku}</div>
          <button
            type="button"
            onClick={() => {
              navigator.clipboard?.writeText(sku).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1800);
              });
            }}
            className="pvx-press mt-2 w-full rounded-full bg-[#F95B02] text-white text-[12px] font-bold py-1.5 cursor-pointer hover:bg-[#DD4F00]"
          >
            {copied ? "¡Copiado!" : "Copiar SKU"}
          </button>
        </div>
      )}
    </div>
  );
}
