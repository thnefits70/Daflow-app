"use client";

import { useEffect } from "react";

/**
 * Evita que la rueda del mouse/touchpad cambie el valor de un input numérico
 * enfocado (comportamiento nativo del navegador que causa cambios accidentales
 * al simplemente pasar el cursor y hacer scroll). El valor solo cambia con lo
 * que el usuario tipea (o las flechas del teclado/spinner).
 */
export function GlobalNumberInputGuard() {
  useEffect(() => {
    function handleWheel(e: WheelEvent) {
      const active = document.activeElement;
      if (active instanceof HTMLInputElement && active.type === "number") {
        active.blur();
      }
    }
    document.addEventListener("wheel", handleWheel, { passive: true });
    return () => document.removeEventListener("wheel", handleWheel);
  }, []);

  return null;
}
