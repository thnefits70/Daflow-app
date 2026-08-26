import { isFixedHoliday } from "@/lib/recognition";

// Horario laboral real de la empresa, confirmado 2026-08-05 — único
// horario usado en todo el sistema para cualquier cálculo de "horas
// laborables" (antes de esto, el reintento de exámenes tenía puesto
// lunes a sábado 8:00-18:00, que nunca fue el horario real).
// Lunes a viernes 8:30-17:00, sábado 8:30-12:30, domingos y feriados no
// laboran. Horas en decimal (8.5 = 8:30).
const ECUADOR_OFFSET_MS = 5 * 60 * 60 * 1000;
const WEEKDAY_WINDOW = { start: 8.5, end: 17 };
const SATURDAY_WINDOW = { start: 8.5, end: 12.5 };

function dayWindow(d: Date): { start: number; end: number } | null {
  const day = d.getUTCDay(); // ya en "hora de Ecuador desplazada"
  if (day === 0) return null; // domingo
  if (isFixedHoliday(d)) return null;
  return day === 6 ? SATURDAY_WINDOW : WEEKDAY_WINDOW;
}

function hourOfDay(d: Date): number {
  return d.getUTCHours() + d.getUTCMinutes() / 60;
}

function atHourOfDay(d: Date, hour: number): Date {
  const out = new Date(d);
  const h = Math.floor(hour);
  const m = Math.round((hour - h) * 60);
  out.setUTCHours(h, m, 0, 0);
  return out;
}

function nextDayStart(d: Date): Date {
  const out = new Date(d);
  out.setUTCDate(out.getUTCDate() + 1);
  out.setUTCHours(0, 0, 0, 0);
  return out;
}

// Adelanta `d` hasta el próximo instante dentro de una jornada laboral
// (puede quedarse en el mismo día si ya está dentro de la ventana).
function snapToWindowStart(d: Date): Date {
  let cur = d;
  while (true) {
    const window = dayWindow(cur);
    if (!window) {
      cur = nextDayStart(cur);
      continue;
    }
    const h = hourOfDay(cur);
    if (h < window.start) return atHourOfDay(cur, window.start);
    if (h >= window.end) {
      cur = nextDayStart(cur);
      continue;
    }
    return cur;
  }
}

// Suma `hours` horas laborables reales a `start` (instante UTC real) y
// devuelve el instante UTC resultante — para cualquier plazo/cooldown que
// deba contarse solo en horario de oficina (reintento de exámenes,
// confirmación de recarga de caja chica, etc.).
export function addBusinessHours(start: Date, hours: number): Date {
  let cur = snapToWindowStart(new Date(start.getTime() - ECUADOR_OFFSET_MS));
  let remainingMs = hours * 60 * 60 * 1000;

  while (remainingMs > 0) {
    const window = dayWindow(cur)!;
    const dayEnd = atHourOfDay(cur, window.end);
    const availableMs = dayEnd.getTime() - cur.getTime();
    if (remainingMs <= availableMs) {
      cur = new Date(cur.getTime() + remainingMs);
      remainingMs = 0;
    } else {
      remainingMs -= availableMs;
      cur = snapToWindowStart(nextDayStart(cur));
    }
  }

  return new Date(cur.getTime() + ECUADOR_OFFSET_MS);
}

// Suma `days` días hábiles reales a `start` y devuelve el instante UTC del
// FIN de la jornada de ese día hábil (plazo de pago de compras personales
// por transferencia, entre otros usos futuros de "N días hábiles" en vez de
// "N horas laborables").
export function addBusinessDays(start: Date, days: number): Date {
  let cur = new Date(start.getTime() - ECUADOR_OFFSET_MS);
  let counted = 0;
  while (counted < days) {
    cur = nextDayStart(cur);
    if (dayWindow(cur)) counted++;
  }
  const window = dayWindow(cur)!;
  return new Date(atHourOfDay(cur, window.end).getTime() + ECUADOR_OFFSET_MS);
}

// ¿Tiene `real` (instante UTC real) horario de oficina ese día en Ecuador?
// L-S sin feriados — a diferencia de isBusinessDay() de recognition.ts, que
// trata sábado como no laborable para efectos de cumpleaños/reconocimientos
// (ver comentario en birthdays.ts); acá sábado sí cuenta, igual que
// SATURDAY_WINDOW arriba.
export function isOfficeDay(real: Date): boolean {
  return dayWindow(new Date(real.getTime() - ECUADOR_OFFSET_MS)) !== null;
}

// Retrocede día a día (calendario Ecuador) desde `real` hasta el último día
// con horario de oficina — para plazos tipo "último día laborable de la
// semana", que si cae domingo o feriado se corre hacia atrás. Devuelve un
// instante UTC real dentro de ese día calendario (misma hora del día que
// `real`, solo cambia la fecha si hizo falta retroceder).
export function lastOfficeDayAtOrBefore(real: Date): Date {
  let cur = real;
  while (!isOfficeDay(cur)) {
    cur = new Date(cur.getTime() - 24 * 60 * 60 * 1000);
  }
  return cur;
}
