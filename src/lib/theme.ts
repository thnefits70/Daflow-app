// Modo día / noche — pedido 2026-09-26 (la gente lo quería en celular y
// laptop). Cada persona elige Claro, Oscuro o Automático; se guarda en SU
// dispositivo (localStorage), no en la base. "Automático" sigue la hora del
// sol en Guayaquil (casi en la línea ecuatorial: sale ~6:00 y se pone ~18:15
// todo el año) — el navegador no deja leer el sensor de luz del celular, así
// que la hora es lo más fiel. Se calcula en hora de Guayaquil (UTC-5, sin
// horario de verano) aunque el dispositivo tenga otra zona horaria.

export type ThemeChoice = "auto" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";

export const THEME_STORAGE_KEY = "daflow-theme";
export const THEME_CHANGE_EVENT = "daflow-theme-change";

const SUNRISE_MIN = 6 * 60;
const SUNSET_MIN = 18 * 60 + 15;

export function isDaytimeInGuayaquil(now: Date = new Date()): boolean {
  const minutes = (((now.getUTCHours() - 5) * 60 + now.getUTCMinutes()) % 1440 + 1440) % 1440;
  return minutes >= SUNRISE_MIN && minutes < SUNSET_MIN;
}

export function readThemeChoice(): ThemeChoice {
  try {
    const v = localStorage.getItem(THEME_STORAGE_KEY);
    if (v === "light" || v === "dark" || v === "auto") return v;
  } catch {}
  return "auto";
}

export function resolveTheme(choice: ThemeChoice): ResolvedTheme {
  if (choice === "auto") return isDaytimeInGuayaquil() ? "light" : "dark";
  return choice;
}

export function applyTheme(choice: ThemeChoice = readThemeChoice()) {
  const resolved = resolveTheme(choice);
  const root = document.documentElement;
  if (root.dataset.theme !== resolved) root.dataset.theme = resolved;
}

export function saveThemeChoice(choice: ThemeChoice) {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, choice);
  } catch {}
  applyTheme(choice);
  window.dispatchEvent(new Event(THEME_CHANGE_EVENT));
}

// Se corre en <head> antes de pintar, para que la página no aparezca un
// instante en el tema equivocado. Misma lógica que arriba, en texto plano.
export const THEME_INIT_SCRIPT = `(function(){try{var c=localStorage.getItem("${THEME_STORAGE_KEY}");if(c!=="light"&&c!=="dark"){var d=new Date();var m=(((d.getUTCHours()-5)*60+d.getUTCMinutes())%1440+1440)%1440;c=(m>=${SUNRISE_MIN}&&m<${SUNSET_MIN})?"light":"dark";}document.documentElement.dataset.theme=c;}catch(e){document.documentElement.dataset.theme="dark";}})();`;
