import { THEME_CHANGE_EVENT, THEME_STORAGE_KEY, applyTheme } from "@/lib/theme";
import { SOUND_CHANGE_EVENT, SOUND_STORAGE_KEY } from "@/lib/sound";

// 2026-10-12: el tema y los sonidos se guardaban como "daflow-theme" /
// "daflow-sound"; se renombraron porque ese código también se carga en
// provedix.com (ahí no debe verse "daflow"). Esto pasa la elección vieja a
// los nombres nuevos. Solo lo llaman los menús de DAFLOW, así este archivo
// nunca llega a provedix.com.
const LEGACY: [string, string, string][] = [
  ["daflow-theme", THEME_STORAGE_KEY, THEME_CHANGE_EVENT],
  ["daflow-sound", SOUND_STORAGE_KEY, SOUND_CHANGE_EVENT],
];

export function migrateLegacyPrefs() {
  try {
    for (const [oldKey, newKey, event] of LEGACY) {
      const v = localStorage.getItem(oldKey);
      if (v === null) continue;
      if (localStorage.getItem(newKey) === null) localStorage.setItem(newKey, v);
      localStorage.removeItem(oldKey);
      if (newKey === THEME_STORAGE_KEY) applyTheme();
      window.dispatchEvent(new Event(event));
    }
  } catch {}
}
