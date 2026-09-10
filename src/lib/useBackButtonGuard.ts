"use client";

import { useEffect, useRef } from "react";

// Pedido de Daniel (2026-09-10): en pantallas con un paso intermedio
// abierto (cámara, escáner, un modal), el botón "atrás" físico/del
// navegador sacaba a la persona de toda la vista en la que estaba en vez
// de simplemente cerrar ese paso. Mientras `active` es true, la primera
// pulsación de "atrás" se consume acá y dispara `onBack` (la misma acción
// que el botón "Cancelar" en pantalla) en vez de dejar que el navegador
// navegue lejos de la página. Si el paso se cierra por otro medio (ej. el
// propio botón "Cancelar"), se descarta la entrada de historial agregada
// para no dejar un "atrás" fantasma más adelante.
export function useBackButtonGuard(active: boolean, onBack: () => void) {
  const onBackRef = useRef(onBack);
  useEffect(() => {
    onBackRef.current = onBack;
  });

  useEffect(() => {
    if (!active) return;
    let consumedByPop = false;
    const handlePopState = () => {
      consumedByPop = true;
      onBackRef.current();
    };
    window.history.pushState({ daflowStep: true }, "");
    window.addEventListener("popstate", handlePopState);
    return () => {
      window.removeEventListener("popstate", handlePopState);
      if (!consumedByPop) window.history.back();
    };
  }, [active]);
}
