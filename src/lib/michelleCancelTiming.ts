import { holidayName, nextWorkingDay } from "@/lib/ecuadorHolidays";
import type { VerifiedGuide } from "@/lib/provedixGuideCheck";

// Horarios para cancelar una guía por el chat de Michelle (ver michelleCancellations.ts).
// ---- Horarios --------------------------------------------------------------

// Salida de cada transportadora (confirmado por Daniel 2026-10-15). El
// sábado solo vienen Veloces, Gintracom y Servientrega (12:00); Urbano y
// Laar salen el siguiente día de trabajo.
function departureMinutes(carrier: string, saturday: boolean): number | null {
  const c = carrier.toUpperCase();
  if (saturday) return /VELOCES|GINTRA|SERVI/.test(c) ? 12 * 60 : null;
  if (/VELOCES/.test(c)) return 11 * 60;
  if (/URBANO/.test(c)) return 13 * 60;
  if (/GINTRA/.test(c)) return 15 * 60;
  return 17 * 60; // Laar y Servientrega
}
const cancelLimitMinutes = (carrier: string) =>
  /VELOCES/i.test(carrier) ? 9 * 60 + 30 : 11 * 60;

function ecuadorNow(d = new Date()): { day: string; minutes: number } {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Guayaquil",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(d)
      .map((x) => [x.type, x.value]),
  );
  return {
    day: `${p.year}-${p.month}-${p.day}`,
    minutes: Number(p.hour) * 60 + Number(p.minute),
  };
}
const dow = (day: string) => new Date(`${day}T12:00:00Z`).getUTCDay();

export type CancelTiming =
  | { kind: "ya_salio" }
  | { kind: "en_horario" }
  | { kind: "fuera_de_horario"; motivo: "hora_limite" | "fin_de_semana" };

export function cancelTiming(
  row: Pick<VerifiedGuide, "carrier" | "manifestDay" | "batch">,
  now = new Date(),
): CancelTiming {
  const { day: today, minutes } = ecuadorNow(now);
  const lotDay = row.batch.lot?.day ?? row.manifestDay ?? today;
  // Día y hora en que sale su transportadora.
  let depDay = lotDay;
  let dep = departureMinutes(row.carrier, dow(lotDay) === 6);
  if (dep == null) {
    depDay = nextWorkingDay(lotDay);
    dep = departureMinutes(row.carrier, dow(depDay) === 6) ?? 17 * 60;
  }
  if (today > depDay || (today === depDay && minutes >= dep))
    return { kind: "ya_salio" };
  const weekend = dow(today) === 0 || dow(today) === 6 || !!holidayName(today);
  if (weekend) return { kind: "fuera_de_horario", motivo: "fin_de_semana" };
  if (today < depDay || minutes < cancelLimitMinutes(row.carrier))
    return { kind: "en_horario" };
  return { kind: "fuera_de_horario", motivo: "hora_limite" };
}
