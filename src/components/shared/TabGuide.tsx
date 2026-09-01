"use client";

import { useEffect, useState } from "react";
import { Info, ChevronDown, ChevronUp } from "lucide-react";

// Tarjeta colapsable "¿Qué hago aquí?" — piloto 2026-08-24 en Reingreso de
// Mercadería (pedido del usuario tras confusión real de Daniel en la
// pestaña "Revisión"). El texto lo decide cada panel según el rol de quien
// mira; este componente solo da el contenedor y recuerda si el usuario ya
// la colapsó (localStorage, por dispositivo — no hace falta persistirlo en
// el server para esto). Pensado para reusarse en otros módulos si el
// piloto funciona.
export function TabGuide({ storageKey, children }: { storageKey: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (localStorage.getItem(`tabguide:v2:${storageKey}`) === "open") setOpen(true);
  }, [storageKey]);

  function toggle() {
    const next = !open;
    setOpen(next);
    localStorage.setItem(`tabguide:v2:${storageKey}`, next ? "open" : "closed");
  }

  return (
    <div className="mb-4 rounded-md border border-teal/30 bg-teal/5 overflow-hidden">
      <button type="button" onClick={toggle} className="w-full flex items-center gap-2 px-3.5 py-2.5 text-left cursor-pointer">
        <Info size={14} className="text-teal shrink-0" />
        <span className="text-[12.5px] font-semibold text-ink flex-1">¿Qué hago aquí?</span>
        {open ? <ChevronUp size={13} className="text-steel shrink-0" /> : <ChevronDown size={13} className="text-steel shrink-0" />}
      </button>
      {open && <div className="px-3.5 pb-3 text-[12px] text-steel leading-relaxed">{children}</div>}
    </div>
  );
}
