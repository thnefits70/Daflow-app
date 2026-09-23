"use client";

import { useEffect, useRef, useState } from "react";
import { BrowserMultiFormatReader } from "@zxing/browser";
import type { IScannerControls } from "@zxing/browser";
import { DecodeHintType } from "@zxing/library";
import { ScanLine, X } from "lucide-react";
import { useBackButtonGuard } from "@/lib/useBackButtonGuard";

type Props = {
  onScanned: (code: string) => void;
  onCancel?: () => void;
};

// Lector nativo del celular (Chrome en Android lo trae). No está en los
// tipos de TypeScript todavía, así que se declara lo mínimo que se usa.
type NativeDetector = { detect: (src: HTMLVideoElement) => Promise<{ rawValue: string }[]> };
type NativeDetectorCtor = {
  new (opts?: { formats?: string[] }): NativeDetector;
  getSupportedFormats?: () => Promise<string[]>;
};

// Cada cuánto se intenta leer un fotograma. Antes quedaba en el valor de
// fábrica de ZXing (500 ms = 2 intentos por segundo).
const SCAN_INTERVAL_MS = 120;
// Si en este tiempo no leyó nada, se muestra el consejo de alejar el celular.
const HINT_AFTER_MS = 4000;

// Confirmado 2026-09-09 (Fase 3, INVESTOCK): mismo patrón de acceso a
// cámara que LiveCameraCapture.tsx (getUserMedia, facingMode:
// "environment") pero leyendo fotogramas en vivo en vez de tomar una sola
// foto — apenas detecta un código, lo entrega al que lo llama y se detiene
// solo (no sigue escaneando de más).
//
// Reporte de Daniel (2026-09-23): de 10 guías, más de la mitad tardaban en
// leer el QR aunque la luz y la hoja estuvieran bien. Causas encontradas:
// (1) solo se intentaba leer 2 veces por segundo, buscando TODOS los tipos
// de código en toda la imagen; (2) nunca se le pedía a la cámara enfoque
// continuo, y de cerca muchos celulares se quedan desenfocados — el QR
// borroso no se lee hasta que el enfoque "cae" solo. Ahora: se usa el
// lector nativo del celular cuando existe (mucho más rápido), si no ZXing
// con ~8 intentos por segundo y modo "esforzarse más", y se pide enfoque
// continuo + un zoom leve para que se pueda escanear a una distancia
// donde la cámara sí enfoca.
export function LiveBarcodeScanner({ onScanned, onCancel }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const stopRef = useRef<() => void>(() => {});
  const [error, setError] = useState("");
  const [showHint, setShowHint] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let stream: MediaStream | null = null;
    let zxingControls: IScannerControls | null = null;
    let loopTimer: ReturnType<typeof setTimeout> | null = null;
    const hintTimer = setTimeout(() => { if (!cancelled) setShowHint(true); }, HINT_AFTER_MS);

    const stopAll = () => {
      cancelled = true;
      clearTimeout(hintTimer);
      if (loopTimer) clearTimeout(loopTimer);
      zxingControls?.stop();
      stream?.getTracks().forEach((t) => t.stop());
    };
    stopRef.current = stopAll;

    const deliver = (text: string) => {
      if (cancelled) return;
      stopAll();
      onScanned(text);
    };

    // Enfoque continuo + zoom leve, solo si la cámara lo soporta. Si falla,
    // se sigue escaneando igual — es una mejora, no un requisito.
    const tuneCamera = async (track: MediaStreamTrack) => {
      try {
        const caps = (track.getCapabilities?.() ?? {}) as MediaTrackCapabilities & {
          focusMode?: string[];
          zoom?: { min: number; max: number };
        };
        const advanced: Record<string, unknown> = {};
        if (caps.focusMode?.includes("continuous")) advanced.focusMode = "continuous";
        if (caps.zoom && caps.zoom.max >= 1.5) advanced.zoom = Math.max(caps.zoom.min, 1.5);
        if (Object.keys(advanced).length) {
          await track.applyConstraints({ advanced: [advanced as MediaTrackConstraintSet] });
        }
      } catch {
        // Cámara que no acepta el ajuste: se deja como viene.
      }
    };

    const startNative = async (Ctor: NativeDetectorCtor, video: HTMLVideoElement) => {
      const supported = (await Ctor.getSupportedFormats?.()) ?? [];
      if (!supported.includes("qr_code")) return false;
      const detector = new Ctor({ formats: supported });
      video.srcObject = stream;
      await video.play().catch(() => {});
      const tick = async () => {
        if (cancelled) return;
        if (video.readyState >= 2) {
          try {
            const found = await detector.detect(video);
            const text = found.find((f) => f.rawValue)?.rawValue;
            if (text) return deliver(text);
          } catch {
            // Fotograma que no se pudo leer — se intenta con el siguiente.
          }
        }
        if (!cancelled) loopTimer = setTimeout(tick, SCAN_INTERVAL_MS);
      };
      tick();
      return true;
    };

    const startZxing = async (video: HTMLVideoElement) => {
      const hints = new Map<DecodeHintType, unknown>([[DecodeHintType.TRY_HARDER, true]]);
      const reader = new BrowserMultiFormatReader(hints, {
        delayBetweenScanAttempts: SCAN_INTERVAL_MS,
        delayBetweenScanSuccess: SCAN_INTERVAL_MS,
      });
      zxingControls = await reader.decodeFromStream(stream!, video, (result) => {
        // Sin resultado ZXing avisa con "error" en cada fotograma — no es un
        // error real, es su forma de decir "todavía no hay código".
        if (result) deliver(result.getText());
      });
      if (cancelled) zxingControls.stop();
    };

    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 960 } },
          audio: false,
        });
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
        const track = stream.getVideoTracks()[0];
        if (track) await tuneCamera(track);
        const video = videoRef.current;
        if (!video || cancelled) return;

        const Ctor = (globalThis as unknown as { BarcodeDetector?: NativeDetectorCtor }).BarcodeDetector;
        const nativeOk = Ctor ? await startNative(Ctor, video).catch(() => false) : false;
        if (!nativeOk && !cancelled) await startZxing(video);
      } catch {
        if (!cancelled) setError("No se pudo acceder a la cámara. Revisá los permisos del navegador e intentá de nuevo.");
      }
    })();

    return stopAll;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Pedido de Daniel (2026-09-10): el botón "atrás" del celular/navegador
  // cerraba la cámara sacándolo de toda la pantalla en la que estaba, en
  // vez de solo cancelar el escaneo. Mientras la cámara está abierta, un
  // "atrás" ahora equivale a tocar "Cancelar".
  useBackButtonGuard(!error && !!onCancel, () => {
    stopRef.current();
    onCancel?.();
  });

  return (
    <div className="bg-cloud border border-rule rounded-md p-3">
      {error ? (
        <div className="text-red text-[12.5px]">{error}</div>
      ) : (
        <div>
          <div className="relative w-full max-w-xs aspect-[4/3] rounded-md overflow-hidden bg-black">
            <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div className="w-3/5 aspect-square border-2 border-teal rounded-md" />
            </div>
          </div>
          <div className="flex items-center gap-2 mt-2.5 text-[12px] text-steel">
            <ScanLine size={13} /> Apunta al código del estante
          </div>
          {showHint && (
            <div className="text-[11.5px] text-yellow mt-1.5">
              ¿No lo lee? Aleja el celular a un palmo (unos 20 cm) y mantenlo quieto un segundo para que enfoque.
            </div>
          )}
          {onCancel && (
            <button type="button" className="flex items-center gap-1 text-[12px] text-steel cursor-pointer mt-2" onClick={() => { stopRef.current(); onCancel(); }}>
              <X size={12} /> Cancelar
            </button>
          )}
        </div>
      )}
    </div>
  );
}
