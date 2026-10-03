"use client";

import { useEffect, useRef, useState } from "react";
import { BrowserMultiFormatReader } from "@zxing/browser";
import type { IScannerControls } from "@zxing/browser";
import { DecodeHintType } from "@zxing/library";
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
const CONTINUOUS_PAUSE_MS = 900;

// Lector nativo del celular (Chrome en Android lo trae). No está en los
// tipos de TypeScript todavía, así que se declara lo mínimo que se usa.
type NativeDetector = { detect: (src: HTMLVideoElement) => Promise<{ rawValue: string; boundingBox?: DOMRectReadOnly }[]> };
type NativeDetectorCtor = {
  new (opts?: { formats?: string[] }): NativeDetector;
  getSupportedFormats?: () => Promise<string[]>;
};

// Cada cuánto se intenta leer un fotograma. Antes quedaba en el valor de
// fábrica de ZXing (500 ms = 2 intentos por segundo).
const SCAN_INTERVAL_MS = 120;
// Si en este tiempo no leyó nada, se muestra el consejo de alejar el celular.
const HINT_AFTER_MS = 4000;
// Si deja de ver el código, los cuadros se borran después de este tiempo.
const BOX_HOLD_MS = 450;

// Rectángulo en píxeles del video original; al guardarlo para dibujar se
// pasa a % del recuadro de la cámara en pantalla.
type Rect = { x: number; y: number; w: number; h: number };
type Detection = { bar: Rect; num: Rect; text: string };

// El video se muestra recortado para llenar el recuadro (object-cover): se
// escala y centra igual que lo hace el navegador.
function toFramePercent(r: Rect, video: HTMLVideoElement, frame: HTMLElement): Rect | null {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  const fw = frame.clientWidth;
  const fh = frame.clientHeight;
  if (!vw || !vh || !fw || !fh) return null;
  const scale = Math.max(fw / vw, fh / vh);
  const ox = (fw - vw * scale) / 2;
  const oy = (fh - vh * scale) / 2;
  return {
    x: ((r.x * scale + ox) / fw) * 100,
    y: ((r.y * scale + oy) / fh) * 100,
    w: ((r.w * scale) / fw) * 100,
    h: ((r.h * scale) / fh) * 100,
  };
}

// Pedido del usuario 2026-10-03: que se vea un cuadro sobre el código de
// barras y otro sobre el número impreso. El cuadro del código sale de lo que
// detecta el lector; el del número se busca en la imagen justo debajo de las
// barras (así vienen impresas las guías) y muestra el número que se leyó —
// no se lee el texto aparte, el número es el mismo que trae el código. Si no
// se encuentra en la imagen, se ubica donde normalmente va.
function numberBoxFor(bar: Rect): Rect {
  const isLinear = bar.w > bar.h * 1.6;
  const h = isLinear ? Math.max(bar.h * 0.5, bar.w * 0.12) : bar.h * 0.22;
  return { x: bar.x + bar.w * 0.08, y: bar.y + bar.h + h * 0.12, w: bar.w * 0.84, h };
}

// ZXing entrega puntos sueltos: 2 en una línea para códigos de barras (solo
// marcan el ancho, en la fila donde lo leyó — la altura se mide después en la
// imagen), 3–4 esquinas para QR. Se arma un rectángulo con ellos.
function rectFromPoints(pts: { x: number; y: number }[]): { rect: Rect; lineOnly: boolean } | null {
  if (pts.length === 0) return null;
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  let w = Math.max(...xs) - x;
  let h = Math.max(...ys) - y;
  if (pts.length <= 2) {
    const pad = w * 0.04;
    return { rect: { x: x - pad, y: y + h / 2, w: w + pad * 2, h: 0 }, lineOnly: true };
  }
  const pad = Math.max(w, h) * 0.12;
  w += pad * 2;
  h += pad * 2;
  return { rect: { x: x - pad, y: y - pad, w, h }, lineOnly: false };
}

let probe: CanvasRenderingContext2D | null = null;

// Mira los píxeles alrededor del código: (1) si solo se sabe la fila donde se
// leyó, sube y baja mientras las filas sigan teniendo el mismo patrón de
// barras → alto real del código; (2) debajo de las barras, salta el espacio
// en blanco y toma la franja con tinta → el número impreso.
function measureInImage(video: HTMLVideoElement, seed: Rect, lineOnly: boolean): { bar: Rect; num: Rect } | null {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (!vw || !vh || seed.w < 20) return null;
  if (!probe) probe = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
  if (!probe) return null;
  const guessH = lineOnly ? seed.w * 0.5 : seed.h;
  const rx = Math.max(0, seed.x - seed.w * 0.1);
  const rw = Math.min(vw - rx, seed.w * 1.2);
  const ry = Math.max(0, seed.y - guessH * (lineOnly ? 1 : 0.2));
  const rh = Math.min(vh - ry, guessH * (lineOnly ? 3 : 2.6));
  const k = Math.min(1, 360 / rw);
  const cw = Math.max(1, Math.round(rw * k));
  const ch = Math.max(1, Math.round(rh * k));
  probe.canvas.width = cw;
  probe.canvas.height = ch;
  probe.drawImage(video, rx, ry, rw, rh, 0, 0, cw, ch);
  const px = probe.getImageData(0, 0, cw, ch).data;
  const lum = new Float32Array(cw * ch);
  let lo = 255;
  let hi = 0;
  for (let i = 0; i < cw * ch; i++) {
    const v = px[i * 4] * 0.3 + px[i * 4 + 1] * 0.59 + px[i * 4 + 2] * 0.11;
    lum[i] = v;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  if (hi - lo < 40) return null; // sin contraste, no se puede medir
  const cut = (lo + hi) / 2;
  const dark = (x: number, y: number) => lum[y * cw + x] < cut;
  const toV = (r: Rect): Rect => ({ x: rx + r.x / k, y: ry + r.y / k, w: r.w / k, h: r.h / k });
  const c0 = Math.max(0, Math.round((seed.x - rx) * k));
  const c1 = Math.min(cw - 1, Math.round((seed.x + seed.w - rx) * k));
  const span = c1 - c0 + 1;

  let top = Math.round((seed.y - ry) * k);
  let bottom = Math.round((seed.y + seed.h - ry) * k);
  if (lineOnly) {
    const same = (a: number, b: number) => {
      let eq = 0;
      for (let x = c0; x <= c1; x++) if (dark(x, a) === dark(x, b)) eq++;
      return eq / span;
    };
    const seedY = Math.min(ch - 1, Math.max(0, top));
    top = bottom = seedY;
    while (top > 0 && same(top - 1, top) > 0.82) top--;
    while (bottom < ch - 1 && same(bottom + 1, bottom) > 0.82) bottom++;
    if (bottom - top < 4) return null;
  }
  const barH = bottom - top;
  const bar = toV({ x: c0, y: top, w: span, h: barH });

  // Número: tinta debajo de las barras, en el ancho del código (+ un margen).
  const n0 = Math.max(0, c0 - Math.round(span * 0.05));
  const n1 = Math.min(cw - 1, c1 + Math.round(span * 0.05));
  const ink = (y: number) => {
    let d = 0;
    for (let x = n0; x <= n1; x++) if (dark(x, y)) d++;
    return d / (n1 - n0 + 1);
  };
  let y = bottom + 1;
  const maxGap = Math.max(3, barH * 0.6);
  while (y < ch && ink(y) < 0.015 && y - bottom < maxGap) y++;
  const start = y;
  let blank = 0;
  while (y < ch && y - start < Math.max(6, barH * 0.9)) {
    if (ink(y) < 0.01) {
      if (++blank >= 2) break;
    } else blank = 0;
    y++;
  }
  const end = y - blank;
  if (start >= ch || end - start < 3) return { bar, num: numberBoxFor(bar) };
  let left = n1;
  let right = n0;
  for (let yy = start; yy < end; yy++) {
    for (let x = n0; x <= n1; x++) {
      if (dark(x, yy)) {
        if (x < left) left = x;
        if (x > right) right = x;
      }
    }
  }
  if (right - left < span * 0.15) return { bar, num: numberBoxFor(bar) };
  const padX = 3;
  const padY = 2;
  return { bar, num: toV({ x: left - padX, y: start - padY, w: right - left + padX * 2, h: end - start + padY * 2 }) };
}

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
  const frameRef = useRef<HTMLDivElement>(null);
  const stopRef = useRef<() => void>(() => {});
  const onScannedRef = useRef(onScanned);
  useEffect(() => {
    onScannedRef.current = onScanned;
  });
  const [error, setError] = useState("");
  const [showHint, setShowHint] = useState(false);
  const [readCount, setReadCount] = useState(0);
  const [detection, setDetection] = useState<Detection | null>(null);
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
    let clearBoxTimer: ReturnType<typeof setTimeout> | null = null;

    const showBox = (seed: Rect | null, text: string, lineOnly = false) => {
      if (cancelled || !seed) return;
      const video = videoRef.current;
      const frame = frameRef.current;
      if (!video || !frame) return;
      let boxes: { bar: Rect; num: Rect } | null = null;
      try {
        boxes = measureInImage(video, seed, lineOnly);
      } catch {
        // Si no se puede medir la imagen, se usan los cuadros estimados.
      }
      if (!boxes) {
        const bar = lineOnly ? { ...seed, y: seed.y - seed.w * 0.14, h: seed.w * 0.28 } : seed;
        boxes = { bar, num: numberBoxFor(bar) };
      }
      const barPct = toFramePercent(boxes.bar, video, frame);
      const numPct = toFramePercent(boxes.num, video, frame);
      if (!barPct || !numPct) return;
      setDetection({ bar: barPct, num: numPct, text });
      if (clearBoxTimer) clearTimeout(clearBoxTimer);
      clearBoxTimer = setTimeout(() => { if (!cancelled) setDetection(null); }, BOX_HOLD_MS);
    };
    const hintTimer = setTimeout(() => { if (!cancelled) setShowHint(true); }, HINT_AFTER_MS);

    const stopAll = () => {
      cancelled = true;
      clearTimeout(hintTimer);
      if (loopTimer) clearTimeout(loopTimer);
      if (clearBoxTimer) clearTimeout(clearBoxTimer);
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
      setReadCount((c) => c + 1);
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
      const detector = new Ctor({ formats: supported });
      video.srcObject = stream;
      await video.play().catch(() => {});
      const tick = async () => {
        if (cancelled) return;
        if (video.readyState >= 2) {
          try {
            const found = await detector.detect(video);
            const hit = found.find((f) => f.rawValue);
            const text = hit?.rawValue;
            if (hit?.boundingBox) {
              const b = hit.boundingBox;
              showBox({ x: b.x, y: b.y, w: b.width, h: b.height }, hit.rawValue);
            }
            if (text && deliver(text) && !continuous) return;
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
        if (!result) return;
        const pts = (result.getResultPoints() ?? []).filter(Boolean).map((p) => ({ x: p.getX(), y: p.getY() }));
        const r = rectFromPoints(pts);
        if (r) showBox(r.rect, result.getText(), r.lineOnly);
        deliver(result.getText());
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
          <div ref={frameRef} className="relative w-full max-w-xs aspect-[4/3] rounded-md overflow-hidden bg-black">
            <style>{SCANNER_CSS}</style>
            <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
            {/* Guía central con línea láser mientras todavía no ve ningún código. */}
            <div className={`pointer-events-none absolute inset-0 flex items-center justify-center transition-opacity duration-200 ${detection ? "opacity-25" : "opacity-100"}`}>
              <div className="relative w-3/5 aspect-square">
                <Corners className="border-teal" />
                <div className="dfs-laser absolute left-[6%] right-[6%] h-[2px] bg-teal shadow-[0_0_8px_2px_rgba(45,212,191,.7)]" />
              </div>
            </div>
            {detection && (
              <>
                <div
                  className="pointer-events-none absolute transition-all duration-100 ease-out"
                  style={{ left: `${detection.bar.x}%`, top: `${detection.bar.y}%`, width: `${detection.bar.w}%`, height: `${detection.bar.h}%` }}
                >
                  <div className="absolute inset-0 bg-teal/15 shadow-[0_0_12px_rgba(45,212,191,.55)] rounded-sm" />
                  <Corners className="border-teal" />
                  <span className="absolute -top-4 left-0 rounded-sm bg-teal px-1 text-[8.5px] font-bold uppercase tracking-wider text-navy">Código</span>
                </div>
                <div
                  className="pointer-events-none absolute transition-all duration-100 ease-out"
                  style={{ left: `${detection.num.x}%`, top: `${detection.num.y}%`, width: `${detection.num.w}%`, height: `${detection.num.h}%` }}
                >
                  <div className="absolute inset-0 border border-dashed border-gold/70 bg-gold/15 shadow-[0_0_10px_rgba(234,179,8,.45)] rounded-sm" />
                  <Corners className="border-gold" />
                  <span className="absolute -bottom-4 left-0 max-w-[200%] truncate rounded-sm bg-gold px-1 font-mono text-[9px] font-bold text-navy">Nº {detection.text}</span>
                </div>
              </>
            )}
            {flashAt > 0 && <div key={flashAt} className="dfs-flash pointer-events-none absolute inset-0 border-4 border-green rounded-md" />}
          </div>
          <div className="flex items-center gap-2 mt-2.5 text-[12px] text-steel">
            <ScanLine size={13} /> {continuous ? "Apunta a cada guía, una tras otra — la cámara queda abierta" : "Apunta al código del estante"}
          </div>
          {continuous && readCount > 0 && (
            <div className="text-[11.5px] text-teal font-semibold mt-1">✓ {readCount} leída(s) — sigue con la siguiente</div>
          )}
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
@keyframes dfs-laser { 0% { top: 8%; } 50% { top: 90%; } 100% { top: 8%; } }
.dfs-laser { animation: dfs-laser 2.2s ease-in-out infinite; }
@keyframes dfs-flash { 0% { opacity: 1; } 100% { opacity: 0; } }
.dfs-flash { animation: dfs-flash .5s ease-out forwards; }
@media (prefers-reduced-motion: reduce) { .dfs-laser { animation: none; top: 50%; } }
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
