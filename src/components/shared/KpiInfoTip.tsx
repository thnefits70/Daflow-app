"use client";

import { useState } from "react";

// Confirmado 2026-08-05: explicación de qué mide/significa cada KPI, oculta
// por defecto (no ocupa espacio) — se despliega solo al hacer clic en "ⓘ".
export function KpiInfoTip({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="¿Qué mide esto?"
        className="w-[15px] h-[15px] rounded-full border border-steel/60 text-steel text-[9px] leading-none flex items-center justify-center cursor-pointer hover:border-ink hover:text-ink shrink-0"
      >
        i
      </button>
      {open && (
        <div className="basis-full w-full text-[11px] text-steel bg-cloud rounded-md p-2.5 mt-1.5 leading-relaxed order-last">
          {children}
        </div>
      )}
    </>
  );
}
