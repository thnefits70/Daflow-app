"use client";

import { useEffect, useState } from "react";
import { Sun, Moon, SunMoon } from "lucide-react";
import {
  applyTheme,
  readThemeChoice,
  saveThemeChoice,
  THEME_CHANGE_EVENT,
  type ThemeChoice,
} from "@/lib/theme";

const OPTIONS: { value: ThemeChoice; label: string; Icon: typeof Sun }[] = [
  { value: "light", label: "Claro", Icon: Sun },
  { value: "auto", label: "Automático (según el sol)", Icon: SunMoon },
  { value: "dark", label: "Oscuro", Icon: Moon },
];

// Montado una sola vez (en Providers): mientras está en "Automático" revisa
// cada minuto si ya salió o se puso el sol y cambia el tema solo.
export function ThemeAutoSwitch() {
  useEffect(() => {
    applyTheme();
    const id = window.setInterval(() => applyTheme(), 60_000);
    const onStorage = () => applyTheme();
    window.addEventListener("storage", onStorage);
    return () => {
      window.clearInterval(id);
      window.removeEventListener("storage", onStorage);
    };
  }, []);
  return null;
}

// Selector de 3 opciones para el pie del menú lateral (fondo navy en ambos temas).
export function ThemeToggle() {
  const [choice, setChoice] = useState<ThemeChoice>("auto");

  useEffect(() => {
    const sync = () => setChoice(readThemeChoice());
    sync();
    window.addEventListener(THEME_CHANGE_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(THEME_CHANGE_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  const current = OPTIONS.find((o) => o.value === choice) ?? OPTIONS[1];

  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-[#C9CFC5] text-[12.5px] truncate">
        {choice === "auto" ? "Tema: auto" : `Tema: ${current.label.toLowerCase()}`}
      </span>
      <div className="flex items-center rounded-md border border-white/15 p-0.5 shrink-0" role="radiogroup" aria-label="Tema de la pantalla">
        {OPTIONS.map(({ value, label, Icon }) => {
          const active = value === choice;
          return (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={active}
              title={label}
              onClick={() => {
                saveThemeChoice(value);
                setChoice(value);
              }}
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
