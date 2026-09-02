import { prisma } from "@/lib/prisma";
import { isBusinessDay } from "@/lib/recognition";

const ECUADOR_UTC_OFFSET_HOURS = 5;

function nowInEcuador(): Date {
  return new Date(Date.now() - ECUADOR_UTC_OFFSET_HOURS * 3600 * 1000);
}

function startOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

// Confirmado 2026-08-31: si el día objetivo (lunes/miércoles/viernes) cae en
// feriado, se corre al siguiente día hábil — mismo principio que
// evaluationDeadline en recognition.ts, pero caminando hacia adelante desde
// un día fijo de la semana en vez de un fin de mes.
function nextBusinessDayOnOrAfter(date: Date): Date {
  let d = date;
  while (!isBusinessDay(d)) d = new Date(d.getTime() + 86400000);
  return d;
}

// Confirmado 2026-08-31: los 3 días reales de lectura de ATOM esta semana
// (lunes/miércoles/viernes calendario), cada uno ya corrido al siguiente día
// hábil si cayó en feriado.
export function atomSyncTargetDatesForWeek(anyDayThisWeek: Date): Date[] {
  const day = anyDayThisWeek.getUTCDay(); // 0=domingo..6=sábado
  const monday = new Date(anyDayThisWeek.getTime() - (day === 0 ? 6 : day - 1) * 86400000);
  const mondayUtc = startOfUtcDay(monday);
  const wednesday = new Date(mondayUtc.getTime() + 2 * 86400000);
  const friday = new Date(mondayUtc.getTime() + 4 * 86400000);
  return [nextBusinessDayOnOrAfter(mondayUtc), nextBusinessDayOnOrAfter(wednesday), nextBusinessDayOnOrAfter(friday)];
}

function isSameUtcDay(a: Date, b: Date): boolean {
  return startOfUtcDay(a).getTime() === startOfUtcDay(b).getTime();
}

// true si hoy es uno de los 3 días en que tocaba leer ATOM y todavía no se
// registró ninguna lectura hoy — usado tanto por el recordatorio del cron
// como por el aviso de "datos desactualizados" en la pantalla de
// Sugerencias de Combos.
export async function isAtomSyncDueToday(): Promise<boolean> {
  const today = nowInEcuador();
  const targets = atomSyncTargetDatesForWeek(today);
  if (!targets.some((t) => isSameUtcDay(t, today))) return false;

  const latest = await prisma.atomProductStatus.findFirst({ orderBy: { capturedAt: "desc" }, select: { capturedAt: true } });
  if (!latest) return true;
  return !isSameUtcDay(latest.capturedAt, today);
}

export type AtomSyncReminderPush = { ownerId: string; title: string; body: string; url: string };

const URL_BASE = "/area/workspace?tab=analisis-mercado&otab=combos";

// Confirmado 2026-08-31: avisa a TODO el equipo de Análisis de Mercado (no a
// una sola persona) — repartido, mismo patrón que
// notifyCancelledGuideBatchSubmitted en cancelledGuides.ts.
export async function getAtomSyncReminderPushes(): Promise<AtomSyncReminderPush[]> {
  if (!(await isAtomSyncDueToday())) return [];

  const mktTeam = await prisma.user.findMany({ where: { department: { code: "MKT" }, isActive: true }, select: { id: true } });
  return mktTeam.map((u) => ({
    ownerId: u.id,
    title: "Actualizar datos de ATOM",
    body: "Hoy toca leer atomapp.com.co/productos — entra a tu cuenta y pídele a Claude que extraiga los datos.",
    url: URL_BASE,
  }));
}
