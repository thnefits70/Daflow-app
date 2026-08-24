"use client";

import { useCallback, useEffect, useRef, useState } from "react";

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

function isTouchDevice() {
  return typeof window !== "undefined" && !!window.matchMedia?.("(hover: none)").matches;
}

async function readImageFromSystemClipboard(): Promise<File | null> {
  if (!navigator.clipboard?.read) return null;
  const items = await navigator.clipboard.read();
  for (const item of items) {
    const imageType = item.types.find((t) => t.startsWith("image/"));
    if (imageType) {
      const blob = await item.getType(imageType);
      return new File([blob], `pegado-${Date.now()}.png`, { type: imageType });
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
  const [tapHint, setTapHint] = useState<string | null>(null);
  const hintTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  const showHint = useCallback((msg: string) => {
    setTapHint(msg);
    if (hintTimer.current) clearTimeout(hintTimer.current);
    hintTimer.current = setTimeout(() => setTapHint(null), 3000);
  }, []);

  // En celular no hay Ctrl+V ni hover para "armar" la caja, así que un toque
  // lee la imagen directamente del portapapeles del sistema (Clipboard API,
  // requiere gesto del usuario + HTTPS). En desktop el toque no hace nada
  // (se mantiene el flujo de hover + Ctrl+V) para no disparar el permiso del
  // portapapeles cada vez que alguien hace clic en la caja para enfocarla.
  const onTapPaste = useCallback(
    async (e: React.MouseEvent | React.TouchEvent) => {
      e.preventDefault();
      if (!isTouchDevice()) return;
      if (!navigator.clipboard?.read) {
        showHint('Este navegador no permite pegar así en celular — usa "seleccionar archivo"');
        return;
      }
      try {
        const file = await readImageFromSystemClipboard();
        if (file) {
          onFile(file);
        } else {
          showHint('No se encontró una imagen en el portapapeles — usa "seleccionar archivo"');
        }
      } catch {
        showHint('No se pudo abrir el portapapeles — usa "seleccionar archivo"');
      }
    },
    [onFile, showHint]
  );

  return { onPaste, onMouseEnter, onMouseLeave, onTapPaste, tapHint };
}
