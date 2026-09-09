"use client";

import { useEffect, useRef, useState } from "react";
import { BrowserMultiFormatReader } from "@zxing/browser";
import type { IScannerControls } from "@zxing/browser";
import { ScanLine, X } from "lucide-react";

type Props = {
  onScanned: (code: string) => void;
  onCancel?: () => void;
};

// Confirmado 2026-09-09 (Fase 3, INVESTOCK): mismo patrón de acceso a
// cámara que LiveCameraCapture.tsx (getUserMedia, facingMode:
// "environment") pero leyendo fotogramas en vivo en vez de tomar una sola
// foto — apenas detecta un código, lo entrega al que lo llama y se detiene
// solo (no sigue escaneando de más).
export function LiveBarcodeScanner({ onScanned, onCancel }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const controlsRef = useRef<IScannerControls | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    const reader = new BrowserMultiFormatReader();

    reader
      .decodeFromConstraints(
        { video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 960 } }, audio: false },
        videoRef.current!,
        (result, err, controls) => {
          controlsRef.current = controls;
          if (cancelled) return;
          if (result) {
            controls.stop();
            onScanned(result.getText());
          }
          // err dispara constantemente mientras no hay código en cuadro —
          // no es un error real, ZXing lo hace así a propósito.
        }
      )
      .catch(() => {
        if (!cancelled) setError("No se pudo acceder a la cámara. Revisá los permisos del navegador e intentá de nuevo.");
      });

    return () => {
      cancelled = true;
      controlsRef.current?.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="bg-cloud border border-rule rounded-md p-3">
      {error ? (
        <div className="text-red text-[12.5px]">{error}</div>
      ) : (
        <div>
          <div className="relative w-full max-w-xs aspect-[4/3] rounded-md overflow-hidden bg-black">
            <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div className="w-3/4 h-1/3 border-2 border-teal rounded-md" />
            </div>
          </div>
          <div className="flex items-center gap-2 mt-2.5 text-[12px] text-steel">
            <ScanLine size={13} /> Apunta al código del estante
          </div>
          {onCancel && (
            <button type="button" className="flex items-center gap-1 text-[12px] text-steel cursor-pointer mt-2" onClick={() => { controlsRef.current?.stop(); onCancel(); }}>
              <X size={12} /> Cancelar
            </button>
          )}
        </div>
      )}
    </div>
  );
}
