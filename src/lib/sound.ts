// Sonidos de DAFLOW — pedido 2026-10-03 (Joel: al leer una guía con la cámara
// no sonaba nada y no sabía si ya la había leído; en otras apps sí suena).
// Cada persona lo activa y elige el tipo de sonido; se guarda en SU
// dispositivo (localStorage), igual que el tema día/noche. Viene apagado.
// Los sonidos se generan en el momento con Web Audio (no hay archivos que
// descargar), así suenan al instante aunque la señal esté lenta.

export type SoundChoice = "off" | "tech" | "classic";
export type SoundKind = "scan" | "success" | "error" | "notify";

export const SOUND_STORAGE_KEY = "daflow-sound";
export const SOUND_CHANGE_EVENT = "daflow-sound-change";

export function readSoundChoice(): SoundChoice {
  try {
    const v = localStorage.getItem(SOUND_STORAGE_KEY);
    if (v === "tech" || v === "classic" || v === "off") return v;
  } catch {}
  return "off";
}

export function saveSoundChoice(choice: SoundChoice) {
  try {
    localStorage.setItem(SOUND_STORAGE_KEY, choice);
  } catch {}
  window.dispatchEvent(new Event(SOUND_CHANGE_EVENT));
  // Al elegirlo se escucha una muestra.
  if (choice !== "off") playSound("scan", choice);
}

let ctx: AudioContext | null = null;

function getCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  try {
    if (!ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return null;
      ctx = new Ctor();
    }
    if (ctx.state === "suspended") void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

// El celular no deja sonar nada hasta que la persona toque la pantalla una
// vez. Se llama en el primer toque (ver SoundUnlock en Providers).
export function unlockAudio() {
  getCtx();
}

type Tone = { at: number; freq: number; to?: number; dur: number; type: OscillatorType; gain: number };

function play(tones: Tone[]) {
  const ac = getCtx();
  if (!ac) return;
  const t0 = ac.currentTime + 0.01;
  for (const t of tones) {
    const osc = ac.createOscillator();
    const g = ac.createGain();
    osc.type = t.type;
    osc.frequency.setValueAtTime(t.freq, t0 + t.at);
    if (t.to) osc.frequency.exponentialRampToValueAtTime(t.to, t0 + t.at + t.dur);
    // Entrada y salida rápidas para que no "chasquee".
    g.gain.setValueAtTime(0.0001, t0 + t.at);
    g.gain.exponentialRampToValueAtTime(t.gain, t0 + t.at + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + t.at + t.dur);
    osc.connect(g).connect(ac.destination);
    osc.start(t0 + t.at);
    osc.stop(t0 + t.at + t.dur + 0.02);
  }
}

// "Tecnológico": chirridos digitales cortos que suben (leído / listo) o bajan (error).
const TECH: Record<SoundKind, Tone[]> = {
  scan: [
    { at: 0, freq: 1400, to: 2600, dur: 0.06, type: "sine", gain: 0.35 },
    { at: 0.07, freq: 2600, to: 3200, dur: 0.07, type: "triangle", gain: 0.3 },
  ],
  success: [
    { at: 0, freq: 880, dur: 0.07, type: "sine", gain: 0.3 },
    { at: 0.07, freq: 1320, dur: 0.07, type: "sine", gain: 0.3 },
    { at: 0.14, freq: 1760, dur: 0.12, type: "sine", gain: 0.3 },
  ],
  error: [
    { at: 0, freq: 520, to: 220, dur: 0.16, type: "sawtooth", gain: 0.18 },
    { at: 0.2, freq: 420, to: 180, dur: 0.2, type: "sawtooth", gain: 0.18 },
  ],
  notify: [
    { at: 0, freq: 1046, dur: 0.09, type: "sine", gain: 0.25 },
    { at: 0.11, freq: 1568, dur: 0.16, type: "sine", gain: 0.25 },
  ],
};

// "Clásico": el bip de la caja del supermercado.
const CLASSIC: Record<SoundKind, Tone[]> = {
  scan: [{ at: 0, freq: 2700, dur: 0.1, type: "square", gain: 0.12 }],
  success: [{ at: 0, freq: 1800, dur: 0.14, type: "square", gain: 0.1 }],
  error: [
    { at: 0, freq: 300, dur: 0.15, type: "square", gain: 0.14 },
    { at: 0.22, freq: 300, dur: 0.15, type: "square", gain: 0.14 },
  ],
  notify: [{ at: 0, freq: 1200, dur: 0.12, type: "square", gain: 0.08 }],
};

const VIBRATE: Record<SoundKind, number | number[]> = { scan: 40, success: 40, error: [80, 60, 80], notify: 30 };

export function playSound(kind: SoundKind, choice: SoundChoice = readSoundChoice()) {
  if (choice === "off") return;
  try {
    play((choice === "tech" ? TECH : CLASSIC)[kind]);
    navigator.vibrate?.(VIBRATE[kind]);
  } catch {
    // Sin sonido no se rompe nada.
  }
}
