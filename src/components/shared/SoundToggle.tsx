"use client";

import { useEffect, useState } from "react";
import { Volume2, VolumeX, Zap } from "lucide-react";
import { readSoundChoice, saveSoundChoice, unlockAudio, SOUND_CHANGE_EVENT, type SoundChoice } from "@/lib/sound";

const OPTIONS: { value: SoundChoice; label: string; Icon: typeof Zap }[] = [
  { value: "off", label: "Sin sonido", Icon: VolumeX },
  { value: "tech", label: "Tecnológico", Icon: Zap },
  { value: "classic", label: "Clásico (bip de caja)", Icon: Volume2 },
];

function useSoundChoice(): SoundChoice {
  const [choice, setChoice] = useState<SoundChoice>("off");
  useEffect(() => {
    const sync = () => setChoice(readSoundChoice());
    sync();
    window.addEventListener(SOUND_CHANGE_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(SOUND_CHANGE_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);
  return choice;
}

// Montado una sola vez (en Providers): el celular no deja sonar nada hasta
// el primer toque en la pantalla; en ese toque se "despierta" el audio.
export function SoundUnlock() {
  useEffect(() => {
    const onFirst = () => {
      unlockAudio();
      window.removeEventListener("pointerdown", onFirst);
      window.removeEventListener("keydown", onFirst);
    };
    window.addEventListener("pointerdown", onFirst);
    window.addEventListener("keydown", onFirst);
    return () => {
      window.removeEventListener("pointerdown", onFirst);
      window.removeEventListener("keydown", onFirst);
    };
  }, []);
  return null;
}

// Selector de 3 opciones para el pie del menú lateral (fondo navy en ambos temas),
// junto al de tema.
export function SoundToggle() {
  const choice = useSoundChoice();
  const current = OPTIONS.find((o) => o.value === choice) ?? OPTIONS[0];

  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-[#C9CFC5] text-[12.5px] truncate">Sonido: {choice === "off" ? "apagado" : current.label.split(" ")[0].toLowerCase()}</span>
      <div className="flex items-center rounded-md border border-white/15 p-0.5 shrink-0" role="radiogroup" aria-label="Sonidos de DAFLOW">
        {OPTIONS.map(({ value, label, Icon }) => {
          const active = value === choice;
          return (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={active}
              title={label}
              onClick={() => saveSoundChoice(value)}
              className={`flex items-center justify-center w-7 h-6 rounded cursor-pointer transition-colors ${
                active ? "bg-teal text-navy" : "text-[#C9CFC5] hover:text-white hover:bg-white/[.08]"
              }`}
            >
              <Icon size={13} />
            </button>
          );
        })}
      </div>
    </div>
  );
}

// Botón chico dentro del escáner: si el sonido está apagado, se prende
// ahí mismo sin ir al menú (en "Tecnológico").
export function ScannerSoundButton() {
  const choice = useSoundChoice();
  const on = choice !== "off";
  return (
    <button
      type="button"
      className={`flex items-center gap-1 text-[11.5px] font-semibold cursor-pointer ${on ? "text-teal" : "text-steel"}`}
      onClick={() => saveSoundChoice(on ? "off" : "tech")}
      title={on ? "Apagar sonido" : "Prender sonido al leer"}
    >
      {on ? <Volume2 size={13} /> : <VolumeX size={13} />} {on ? "Sonido prendido" : "Prender sonido"}
    </button>
  );
}
