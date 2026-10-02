// Calendario automático de días de descanso en Ecuador (pedido del usuario
// 2026-10-02: "debería ser automático en base al calendario del país y sus
// feriados"). Sin imports de servidor: se usa también en el navegador.
//
// Ley de Feriados (Código del Trabajo, reforma 2016–2017), verificada el
// 2026-10-02 con el calendario oficial de 2026:
//   - feriado en martes   → se descansa el lunes anterior
//   - miércoles o jueves  → el viernes de esa misma semana
//   - sábado              → el viernes anterior
//   - domingo             → el lunes siguiente
//   - no se trasladan: 1 de enero, 25 de diciembre, Carnaval y 2 de
//     noviembre (en domingo, 1/ene y 25/dic se descansan el lunes).
// Además del 9 de octubre (nacional), Guayaquil tiene el 25 de julio
// (Fundación), con la misma regla de traslado.
// Lo que el Gobierno decrete aparte (puentes extra) no se puede adivinar.

const pad = (n: number) => String(n).padStart(2, "0");
const iso = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000);

// Domingo de Pascua (algoritmo de Meeus/Jones/Butcher).
function easterSunday(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return utc(year, month, day);
}

// Aplica la regla de traslado (0 = domingo … 6 = sábado).
function transferred(date: Date): Date {
  switch (date.getUTCDay()) {
    case 2:
      return addDays(date, -1); // martes → lunes
    case 3:
      return addDays(date, 2); // miércoles → viernes
    case 4:
      return addDays(date, 1); // jueves → viernes
    case 6:
      return addDays(date, -1); // sábado → viernes
    case 0:
      return addDays(date, 1); // domingo → lunes
    default:
      return date;
  }
}

const cache = new Map<number, Map<string, string>>();

// Días de descanso del año: "YYYY-MM-DD" → nombre del feriado.
export function ecuadorRestDays(year: number): Map<string, string> {
  const hit = cache.get(year);
  if (hit) return hit;
  const out = new Map<string, string>();
  const put = (d: Date, name: string) => out.set(iso(d), name);
  const sundayToMonday = (d: Date) => (d.getUTCDay() === 0 ? addDays(d, 1) : d);

  put(sundayToMonday(utc(year, 1, 1)), "Año Nuevo");
  const easter = easterSunday(year);
  put(addDays(easter, -48), "Carnaval");
  put(addDays(easter, -47), "Carnaval");
  put(addDays(easter, -2), "Viernes Santo");
  put(transferred(utc(year, 5, 1)), "Día del Trabajo");
  put(transferred(utc(year, 5, 24)), "Batalla de Pichincha");
  put(transferred(utc(year, 7, 25)), "Fundación de Guayaquil");
  put(transferred(utc(year, 8, 10)), "Primer Grito de Independencia");
  put(transferred(utc(year, 10, 9)), "Independencia de Guayaquil");
  // Difuntos (2/nov) no se mueve; Independencia de Cuenca (3/nov) se
  // descansa pegada a Difuntos cuando caen lunes-martes (caso 2026), si no
  // sigue la regla normal.
  const nov2 = utc(year, 11, 2);
  put(nov2, "Día de los Difuntos");
  const nov3 = utc(year, 11, 3);
  put(nov2.getUTCDay() === 1 ? nov3 : transferred(nov3), "Independencia de Cuenca");
  put(sundayToMonday(utc(year, 12, 25)), "Navidad");

  cache.set(year, out);
  return out;
}

export function holidayName(day: string): string | null {
  return ecuadorRestDays(Number(day.slice(0, 4))).get(day) ?? null;
}

// Día de trabajo en la bodega: lunes a sábado que no sea feriado. El sábado
// de un fin de semana largo (viernes o lunes feriado) tampoco se trabaja —
// confirmado por el usuario: "trabajamos hasta el jueves y regresamos el
// lunes" en la semana del 9 de octubre de 2026.
export function isWorkingDay(day: string): boolean {
  const d = new Date(`${day}T12:00:00Z`);
  const dow = d.getUTCDay();
  if (dow === 0 || holidayName(day)) return false;
  if (dow === 6 && (holidayName(iso(addDays(d, -1))) || holidayName(iso(addDays(d, 2))))) return false;
  return true;
}

export function nextWorkingDay(day: string): string {
  let d = addDays(new Date(`${day}T12:00:00Z`), 1);
  while (!isWorkingDay(iso(d))) d = addDays(d, 1);
  return iso(d);
}

// Último día de trabajo antes de `day` (sin contarlo).
export function previousWorkingDay(day: string): string {
  let d = addDays(new Date(`${day}T12:00:00Z`), -1);
  while (!isWorkingDay(iso(d))) d = addDays(d, -1);
  return iso(d);
}

// Pedido del usuario 2026-10-02: un manifiesto se sube el mismo día o, a
// más tardar, el siguiente día de trabajo (sábado → lunes; jueves antes de
// un viernes feriado → lunes). Después se deja subir igual, pero queda
// marcado como atrasado y se avisa al administrador.
export function manifestDeadline(manifestDay: string): string {
  return nextWorkingDay(manifestDay);
}

export function isManifestLate(manifestDay: string, uploadDay: string): boolean {
  return uploadDay > manifestDeadline(manifestDay);
}
