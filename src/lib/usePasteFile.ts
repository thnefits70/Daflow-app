"use client";

import { useCallback } from "react";

// Confirmado 2026-07-30 (bug real reportado por el usuario): las cajas de
// subida decían "Ctrl+V para pegar" pero nunca se implementó el pegado, solo
// el clic para elegir archivo. Se usa junto con tabIndex={0} en el elemento
// contenedor para que reciba foco (y por lo tanto el evento paste) con solo
// hacer clic en la caja antes de pegar.
export function usePasteFile(onFile: (file: File) => void) {
  return useCallback(
    (e: React.ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of items) {
        if (item.type.startsWith("image/")) {
          const file = item.getAsFile();
          if (file) {
            e.preventDefault();
            onFile(file);
            return;
          }
        }
      }
    },
    [onFile]
  );
}
