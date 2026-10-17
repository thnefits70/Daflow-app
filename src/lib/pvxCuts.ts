import { isWorkingDay, nextWorkingDay } from "@/lib/ecuadorHolidays";

// Cortes del día (tabla "PROVEDIX - CORTES Y DESPACHOS", la vigente). Lo usan
// el reloj de cortes de provedix.com y Michelle IA (2026-10-17: sin la hora no
// sabía cuál es el PRÓXIMO corte y respondía con la tabla entera). Sin imports
// de servidor: corre también en el navegador.

export const CUTS = [
  { label: "Corte de la mañana", print: [8 * 60 + 30, 9 * 60], printText: "8:30 – 9:00", dispatchText: "9:00 – 11:00" },
  { label: "Corte del mediodía", print: [11 * 60, 11 * 60 + 30], printText: "11:00 – 11:30", dispatchText: "11:30 – 14:00" },
  { label: "Corte de la tarde", print: [14 * 60, 14 * 60 + 30], printText: "14:00 – 14:30", dispatchText: "14:30 – 16:00" },
] as const;
// Sábado (confirmado por el usuario 2026-10-13): se trabaja de 8:30 a 12:30
// y hay UN solo corte, el de la mañana, solo con Veloces, Servientrega y
// Gintracom.
export const SATURDAY_CARRIERS = "Veloces, Servientrega y Gintracom";

const WEEKDAY = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];

function ecuadorNow(): { day: string; minutes: number; seconds: number; dow: number } {
  // Ecuador: UTC−5 todo el año, sin horario de verano.
  const d = new Date(Date.now() - 5 * 3_600_000);
  const seconds = d.getUTCHours() * 3600 + d.getUTCMinutes() * 60 + d.getUTCSeconds();
  return { day: d.toISOString().slice(0, 10), minutes: Math.floor(seconds / 60), seconds, dow: d.getUTCDay() };
}

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000);
}

function cutsFor(dow: number) {
  return dow === 6 ? CUTS.slice(0, 1) : CUTS;
}

// countdown: segundos que faltan; countdownLabel: qué se está contando.
export type CutState = { active: number | null; title: string; detail: string; saturday: boolean; countdown: number | null; countdownLabel: string };

export function cutState(): CutState {
  const { day, minutes, seconds, dow } = ecuadorNow();
  const saturday = dow === 6;
  // Segundos hasta el primer corte (8:30) del siguiente día de trabajo.
  const toNextMorning = () => daysBetween(day, nextWorkingDay(day)) * 86_400 + CUTS[0].print[0] * 60 - seconds;
  // Próximo día de trabajo; si es sábado, se avisa que ese día hay un solo corte.
  const nextDay = () => {
    const n = nextWorkingDay(day);
    const ndow = new Date(`${n}T12:00:00Z`).getUTCDay();
    const when = ndow === (dow + 1) % 7 ? "de mañana" : `del ${WEEKDAY[ndow]}`;
    return ndow === 6 ? `${when}, a las 8:30 (el sábado hay un solo corte, con ${SATURDAY_CARRIERS})` : `${when}, a las 8:30`;
  };
  if (!isWorkingDay(day)) {
    return { active: null, saturday, title: "Hoy no despachamos", detail: `Los pedidos que confirmes hoy salen en el primer corte ${nextDay()}.`, countdown: toNextMorning(), countdownLabel: "Próximo corte en" };
  }
  const satNote = saturday ? ` Hoy sábado hay un solo corte, con ${SATURDAY_CARRIERS}.` : "";
  const cuts = cutsFor(dow);
  for (let i = 0; i < cuts.length; i++) {
    const [from, to] = cuts[i].print;
    if (minutes < from)
      return { active: i, saturday, title: "Próximo corte en", detail: `${cuts[i].label}: imprimimos guías a las ${cuts[i].printText.split(" – ")[0]} y despachamos de ${cuts[i].dispatchText}.${satNote}`, countdown: from * 60 - seconds, countdownLabel: "" };
    if (minutes < to)
      return { active: i, saturday, title: "Imprimiendo guías ahora", detail: `${cuts[i].label}: lo que entra ahora sale de ${cuts[i].dispatchText}.${satNote}`, countdown: to * 60 - seconds, countdownLabel: "Este corte cierra en" };
  }
  return { active: null, saturday, title: saturday ? "El corte del sábado ya pasó" : "Los cortes de hoy ya terminaron", detail: `Lo que confirmes ahora sale en el primer corte ${nextDay()}.`, countdown: toNextMorning(), countdownLabel: "Próximo corte en" };
}

// Para Michelle IA: la hora de Ecuador y el corte que viene, ya calculados.
export function cutNowText(): string {
  const { day, minutes, dow } = ecuadorNow();
  const hhmm = `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}`;
  const s = cutState();
  const left = s.countdown != null && s.countdown < 6 * 3600 ? ` (faltan unos ${Math.max(1, Math.round(s.countdown / 60))} minutos)` : "";
  return `AHORA MISMO EN ECUADOR: ${WEEKDAY[dow]} ${day}, ${hhmm}.
CORTE EN ESTE MOMENTO: ${s.title === "Próximo corte en" ? "el próximo es este." : `${s.title}.`} ${s.detail}${left}`;
}
