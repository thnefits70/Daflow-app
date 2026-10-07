"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

// Minimal local typing for the (non-standard, not in lib.dom.d.ts everywhere)
// Web Speech API — avoids pulling in a dependency or touching global types.
// Chrome/Edge support this well; Safari/Firefox support is partial, so the
// mic button just hides when unsupported instead of erroring.
type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};
type SpeechWindow = Window & {
  SpeechRecognition?: new () => SpeechRecognitionLike;
  webkitSpeechRecognition?: new () => SpeechRecognitionLike;
};

// Errores tras los que NO tiene sentido seguir reintentando (permiso negado,
// sin micrófono); "no-speech"/"network"/"aborted" son cortes normales y se
// reanuda solo.
const FATAL_ERRORS = new Set(["not-allowed", "service-not-allowed", "audio-capture", "language-not-supported"]);

type DictationState = {
  wanted: boolean;
  recognition: SpeechRecognitionLike | null;
  // Texto ya confirmado (lo escrito antes + tramos anteriores) y lo que va
  // el tramo actual.
  base: string;
  segment: string;
  // Tramo descartado por una corrección a mano: se deja terminar (nunca dos
  // reconocimientos a la vez) pero sus palabras ya no se usan.
  discarded: SpeechRecognitionLike | null;
  setInput: (value: string) => void;
  setListening: (value: boolean) => void;
};

function getCtor() {
  const sw = window as SpeechWindow;
  return sw.SpeechRecognition || sw.webkitSpeechRecognition;
}

function joinText(base: string, extra: string) {
  const a = base.trimEnd();
  const b = extra.trim();
  if (!a) return b;
  if (!b) return a;
  return `${a} ${b}`;
}

function startSegment(s: DictationState) {
  const Ctor = getCtor();
  if (!Ctor || !s.wanted) return;

  const recognition = new Ctor();
  recognition.lang = "es-EC";
  recognition.continuous = false;
  recognition.interimResults = true;
  s.segment = "";
  recognition.onresult = (event) => {
    if (s.recognition !== recognition || s.discarded === recognition) return;
    let transcript = "";
    for (let i = 0; i < event.results.length; i++) transcript += event.results[i][0].transcript;
    s.segment = transcript;
    s.setInput(joinText(s.base, transcript));
  };
  recognition.onerror = (event) => {
    if (event.error && FATAL_ERRORS.has(event.error)) s.wanted = false;
  };
  recognition.onend = () => {
    if (s.recognition !== recognition) return;
    if (s.discarded !== recognition) s.base = joinText(s.base, s.segment);
    s.discarded = null;
    s.segment = "";
    if (s.wanted) {
      try {
        startSegment(s);
        return;
      } catch {
        s.wanted = false;
      }
    }
    s.recognition = null;
    s.setListening(false);
  };
  s.recognition = recognition;
  recognition.start();
}

const subscribeNoop = () => () => {};

// Dictado por voz compartido por Mary (WeeklyCheckinPanel) y Nancy.
// Pedido de Daniel 2026-10-07: antes el micrófono se apagaba solo si la
// persona hacía una pausa de ~1 segundo. El navegador corta cada "tramo" de
// reconocimiento al detectar silencio (en Android incluso con
// continuous=true), así que al terminar un tramo se guarda lo dicho y se
// arranca otro de inmediato — el micrófono queda encendido hasta que la
// persona lo apague o envíe el mensaje (`stop()`).
export function useDictation(input: string, setInput: (value: string) => void) {
  const supported = useSyncExternalStore(subscribeNoop, () => !!getCtor(), () => false);
  const [listening, setListening] = useState(false);
  const stateRef = useRef<DictationState>({
    wanted: false,
    recognition: null,
    base: "",
    segment: "",
    discarded: null,
    setInput,
    setListening,
  });

  useEffect(() => {
    stateRef.current.setInput = setInput;
  }, [setInput]);

  const stop = useCallback(() => {
    const s = stateRef.current;
    s.wanted = false;
    const current = s.recognition;
    s.recognition = null;
    s.segment = "";
    setListening(false);
    current?.abort();
  }, []);

  const toggle = useCallback(() => {
    const s = stateRef.current;
    if (s.wanted) {
      // Apagado a mano: el texto ya está en el campo, solo se corta.
      stop();
      return;
    }
    s.wanted = true;
    s.base = input;
    setListening(true);
    try {
      startSegment(s);
    } catch {
      stop();
    }
  }, [input, stop]);

  // Si la persona corrige el texto a mano mientras dicta, lo escrito pasa a
  // ser la base y el tramo en curso se descarta para no pisarlo (al
  // terminar, arranca otro tramo solo).
  const onManualEdit = useCallback(
    (value: string) => {
      setInput(value);
      const s = stateRef.current;
      if (!s.wanted) return;
      s.base = value;
      s.segment = "";
      if (s.recognition) {
        s.discarded = s.recognition;
        s.recognition.stop();
      }
    },
    [setInput],
  );

  // Al desmontar (cerrar la pantalla) se libera el micrófono.
  useEffect(() => {
    const s = stateRef.current;
    return () => {
      s.wanted = false;
      s.recognition?.abort();
      s.recognition = null;
    };
  }, []);

  return { supported, listening, toggle, stop, onManualEdit };
}
