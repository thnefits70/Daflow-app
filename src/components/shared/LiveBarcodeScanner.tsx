"use client";

import { useEffect, useRef, useState } from "react";
import { BrowserMultiFormatReader } from "@zxing/browser";
import type { IScannerControls } from "@zxing/browser";
import { BarcodeFormat, DecodeHintType } from "@zxing/library";
import { ScanLine, X } from "lucide-react";
import { useBackButtonGuard } from "@/lib/useBackButtonGuard";
import { playSound } from "@/lib/sound";
import { ScannerSoundButton } from "@/components/shared/SoundToggle";

type Props = {
  onScanned: (code: string) => void;
  onCancel?: () => void;
  // La cámara queda abierta y sigue leyendo un código tras otro (ej. guías
  // de reingreso). El mismo código no se vuelve a entregar seguido.
  continuous?: boolean;
};

// Modo continuo: tiempo mínimo antes de volver a entregar el MISMO código, y
// pausa corta después de cada lectura para no leer la etiqueta dos veces.
const CONTINUOUS_SAME_CODE_MS = 4000;
const CONTINUOUS_PAUSE_MS = 250;

// Lector nativo del celular (Chrome en Android lo trae). No está en los
// tipos de TypeScript todavía, así que se declara lo mínimo que se usa.
type NativeDetector = { detect: (src: HTMLVideoElement) => Promise<{ rawValue: string }[]> };
type NativeDetectorCtor = {
  new (opts?: { formats?: string[] }): NativeDetector;
  getSupportedFormats?: () => Promise<string[]>;
};

// Cada cuánto se intenta leer un fotograma. Antes quedaba en el valor de
// fábrica de ZXing (500 ms = 2 intentos por segundo).
const SCAN_INTERVAL_MS = 80;
// Lector nativo: el propio detect() ya tarda unos 30–80 ms, así que entre un
// intento y otro basta una espera corta (≈15+ intentos por segundo).
const NATIVE_INTERVAL_MS = 30;
// Si en este tiempo no leyó nada, se muestra el consejo de alejar el celular.
const HINT_AFTER_MS = 4000;
// Reporte 2026-10-03: con los cuadros sobre el código y el número tardaba en
// leer. Joel pidió quitarlos y dejarlo simple: se quitaron (nada se dibuja ni
// se mide por fotograma), solo queda el visor fijo y un destello al leer. Se
// buscan solo los tipos que usamos — guías (barras / QR) y etiquetas de
// DAFLOW (QR) — no PDF417, Aztec, MaxiCode…
const NATIVE_FORMATS = ["qr_code", "code_128", "code_39", "code_93", "codabar", "itf", "ean_13", "ean_8", "upc_a"];
const ZXING_FORMATS = [
  BarcodeFormat.QR_CODE,
  BarcodeFormat.CODE_128,
  BarcodeFormat.CODE_39,
  BarcodeFormat.CODE_93,
  BarcodeFormat.CODABAR,
  BarcodeFormat.ITF,
  BarcodeFormat.EAN_13,
  BarcodeFormat.EAN_8,
  BarcodeFormat.UPC_A,
];

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
//
// Reporte de Joel (2026-10-03, reingreso por guía): después de cada guía la
// cámara se cerraba y había que tocar el botón otra vez. Se intentaba
// "reabrirla" desmontando el escáner, pero al desmontarse el seguro del
// botón atrás hacía history.back() y el escáner nuevo lo tomaba como un
// "atrás" → se cerraba. Ahora con `continuous` la cámara nunca se cierra.
export function LiveBarcodeScanner({ onScanned, onCancel, continuous = false }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const stopRef = useRef<() => void>(() => {});
  const onScannedRef = useRef(onScanned);
  useEffect(() => {
    onScannedRef.current = onScanned;
  });
  const [error, setError] = useState("");
  const [showHint, setShowHint] = useState(false);
  // Destello verde cuando una lectura se entrega (no en cada fotograma).
  const [flashAt, setFlashAt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let stream: MediaStream | null = null;
    let zxingControls: IScannerControls | null = null;
    let loopTimer: ReturnType<typeof setTimeout> | null = null;
    let lastText = "";
    let lastAt = 0;
    let pausedUntil = 0;

    const hintTimer = setTimeout(() => { if (!cancelled) setShowHint(true); }, HINT_AFTER_MS);

    const stopAll = () => {
      cancelled = true;
      clearTimeout(hintTimer);
      if (loopTimer) clearTimeout(loopTimer);
      zxingControls?.stop();
      stream?.getTracks().forEach((t) => t.stop());
    };
    stopRef.current = stopAll;

    // Devuelve true si la lectura se entregó.
    const deliver = (text: string) => {
      if (cancelled) return false;
      if (!continuous) {
        playSound("scan");
        setFlashAt(Date.now());
        stopAll();
        onScannedRef.current(text);
        return true;
      }
      const now = Date.now();
      if (now < pausedUntil) return false;
      if (text === lastText && now - lastAt < CONTINUOUS_SAME_CODE_MS) {
        lastAt = now; // sigue apuntando a la misma etiqueta
        return false;
      }
      lastText = text;
      lastAt = now;
      pausedUntil = now + CONTINUOUS_PAUSE_MS;
      setShowHint(false);
      playSound("scan");
      setFlashAt(now);
      onScannedRef.current(text);
      return true;
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
      const formats = NATIVE_FORMATS.filter((f) => supported.includes(f));
      const detector = new Ctor({ formats });
      video.srcObject = stream;
      await video.play().catch(() => {});
      const tick = async () => {
        if (cancelled) return;
        if (video.readyState >= 2) {
          try {
            const found = await detector.detect(video);
            const text = found.find((f) => f.rawValue)?.rawValue;
            if (text && deliver(text) && !continuous) return;
          } catch {
            // Fotograma que no se pudo leer — se intenta con el siguiente.
          }
        }
        if (!cancelled) loopTimer = setTimeout(tick, NATIVE_INTERVAL_MS);
      };
      tick();
      return true;
    };

    const startZxing = async (video: HTMLVideoElement) => {
      const hints = new Map<DecodeHintType, unknown>([
        [DecodeHintType.TRY_HARDER, true],
        [DecodeHintType.POSSIBLE_FORMATS, ZXING_FORMATS],
      ]);
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
            <style>{SCANNER_CSS}</style>
            <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div className="relative w-3/5 aspect-square">
                <Corners className="border-teal" />
              </div>
            </div>
            {flashAt > 0 && <div key={flashAt} className="dfs-flash pointer-events-none absolute inset-0 border-4 border-green rounded-md" />}
          </div>
          <div className="flex items-center gap-2 mt-2.5 text-[12px] text-steel">
            <ScanLine size={13} /> {continuous ? "Apunta a cada guía, una tras otra — la cámara queda abierta" : "Apunta al código del estante"}
          </div>
          {showHint && (
            <div className="text-[11.5px] text-yellow mt-1.5">
              ¿No lo lee? Aleja el celular a un palmo (unos 20 cm) y mantenlo quieto un segundo para que enfoque.
            </div>
          )}
          <div className="flex items-center justify-between gap-3 mt-2">
            {onCancel ? (
              <button type="button" className="flex items-center gap-1 text-[12px] text-steel cursor-pointer" onClick={() => { stopRef.current(); onCancel(); }}>
                <X size={12} /> Cancelar
              </button>
            ) : <span />}
            <ScannerSoundButton />
          </div>
        </div>
      )}
    </div>
  );
}

const SCANNER_CSS = `
@keyframes dfs-flash { 0% { opacity: 1; } 100% { opacity: 0; } }
.dfs-flash { animation: dfs-flash .5s ease-out forwards; }
`;

// Esquinas tipo visor (en vez de un cuadro cerrado).
function Corners({ className }: { className: string }) {
  const base = `absolute w-[18%] h-[18%] min-w-2.5 min-h-2.5 ${className}`;
  return (
    <>
      <span className={`${base} left-0 top-0 border-l-2 border-t-2 rounded-tl-sm`} />
      <span className={`${base} right-0 top-0 border-r-2 border-t-2 rounded-tr-sm`} />
      <span className={`${base} left-0 bottom-0 border-l-2 border-b-2 rounded-bl-sm`} />
      <span className={`${base} right-0 bottom-0 border-r-2 border-b-2 rounded-br-sm`} />
    </>
  );
}
