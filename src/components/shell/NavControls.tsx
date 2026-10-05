"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, RotateCw } from "lucide-react";

// Pedido del usuario 2026-10-05: instalada como app (Mac "Añadir al Dock",
// iPhone "Añadir a inicio") DAFLOW no tiene barra del navegador — no había
// cómo volver a la página anterior ni refrescar. Estos dos botones van en la
// barra del menú lateral (y en la barra superior del celular).
// `labeled`: versión con texto para el menú lateral de computadora; sin él,
// solo íconos para la barra superior del celular.
export function NavControls({ homeHref, labeled = false, className = "" }: { homeHref: string; labeled?: boolean; className?: string }) {
  const router = useRouter();
  const [reloading, setReloading] = useState(false);

  const goBack = () => {
    // Si se abrió directo (desde un aviso o el ícono) no hay historial: va al Inicio.
    if (window.history.length > 1) router.back();
    else router.push(homeHref);
  };

  const reload = () => {
    setReloading(true);
    window.location.reload();
  };

  const BTN = labeled
    ? "flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-md border border-white/15 text-[12px] text-[#C9CFC5] hover:text-white hover:bg-white/10 active:opacity-70 cursor-pointer"
    : "p-1.5 rounded-md text-white/80 hover:text-white hover:bg-white/10 active:opacity-70 cursor-pointer";
  return (
    <div className={`flex items-center ${labeled ? "gap-2" : "gap-0.5"} ${className}`}>
      <button type="button" onClick={goBack} className={BTN} aria-label="Volver atrás" title="Volver atrás">
        <ArrowLeft size={labeled ? 14 : 18} />
        {labeled && "Atrás"}
      </button>
      <button type="button" onClick={reload} disabled={reloading} className={BTN} aria-label="Refrescar página" title="Refrescar página">
        <RotateCw size={labeled ? 13 : 17} className={reloading ? "animate-spin" : ""} />
        {labeled && "Refrescar"}
      </button>
    </div>
  );
}
