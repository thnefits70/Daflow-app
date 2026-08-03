"use client";

import { useCallback, useEffect, useRef } from "react";

function isEditableFocused() {
  const el = document.activeElement as HTMLElement | null;
  if (!el) return false;
  return el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable;
}

function extractImageFile(items: DataTransferItemList | undefined) {
  if (!items) return null;
  for (const item of items) {
    if (item.type.startsWith("image/")) {
      const file = item.getAsFile();
      if (file) return file;
    }
  }
  return null;
}

// Confirmado 2026-08-03: antes solo se podía pegar haciendo clic primero (el
// evento paste nativo solo dispara sobre el elemento con foco) — ahora basta
// con pasar el mouse por encima de la caja para "armarla", sin necesidad de
// hacer clic, y Ctrl+V la captura mediante un listener global. Si hay un
// input/textarea con foco (la persona está escribiendo/pegando texto en otro
// campo), se ignora aunque el mouse esté encima, para no robarle ese pegado.
export function usePasteFile(onFile: (file: File) => void) {
  const armed = useRef(false);

  useEffect(() => {
    function handleGlobalPaste(e: ClipboardEvent) {
      if (!armed.current || isEditableFocused()) return;
      const file = extractImageFile(e.clipboardData?.items);
      if (file) {
        e.preventDefault();
        onFile(file);
      }
    }
    document.addEventListener("paste", handleGlobalPaste);
    return () => document.removeEventListener("paste", handleGlobalPaste);
  }, [onFile]);

  const onPaste = useCallback(
    (e: React.ClipboardEvent) => {
      const file = extractImageFile(e.clipboardData?.items);
      if (file) {
        e.preventDefault();
        onFile(file);
      }
    },
    [onFile]
  );
  const onMouseEnter = useCallback(() => {
    armed.current = true;
  }, []);
  const onMouseLeave = useCallback(() => {
    armed.current = false;
  }, []);

  return { onPaste, onMouseEnter, onMouseLeave };
}
