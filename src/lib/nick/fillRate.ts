import { prisma } from "@/lib/prisma";
import { nextWorkingDay } from "@/lib/ecuadorHolidays";

// Pedido del usuario 2026-10-17: "Preparadas" y "Generadas" vuelven al Fill
// Rate, ahora automáticas con lo que NICK ve en Dropi (antes se escribían a
// mano y casi siempre daban 0). Entran al % y las ve todo el que tiene la
// tarjeta en Inicio. Se mira el estado de la guía en Dropi al día siguiente
// laborable de su día de salida, a las 17:00 (ya se fueron todas las
// transportadoras y Dropi ya registró el primer escaneo; el sábado a las
// 12:30, porque NICK solo lee en horario de trabajo):
// - sigue en "GUIA_GENERADA" (o pendiente)      → Generada: no se empacó.
// - sigue en "PREPARADO PARA TRANSPORTADORA"     → Preparada: se empacó pero
//                                                   la transportadora no la recogió.
// Si NICK todavía no había visto la guía a esa hora, no se cuenta.
export { NICK_FILL_RATE_FROM_WEEK } from "@/lib/nick/fillRateWeek";

const isGenerated = (s: string) => /^(PENDIENTE|GENERANDO[_ ]GUIA|GUIA[_ ]GENERADA)/i.test(s.trim());
const isPrepared = (s: string) => /^PREPARADO PARA TRANSPORTADORA/i.test(s.trim());

export async function nickPreparedGenerated(guides: { guideNumber: string; dispatchDay: string }[], now = new Date()) {
  const checkAt = new Map<string, Date>();
  for (const g of guides) {
    const day = nextWorkingDay(g.dispatchDay);
    // El sábado NICK lee hasta las 12:30 (fin del horario): se revisa a esa hora.
    const saturday = new Date(`${day}T12:00:00Z`).getUTCDay() === 6;
    const at = new Date(`${day}T${saturday ? "12:30" : "17:00"}:00-05:00`);
    if (at.getTime() <= now.getTime()) checkAt.set(g.guideNumber.trim().toUpperCase().replace(/\s+/g, ""), at);
  }
  if (!checkAt.size) return { prepared: 0, generated: 0, checked: 0, pending: guides.length };
  const keys = [...checkAt.keys()];
  const changes = await prisma.nickGuideStatusChange.findMany({
    where: { guideNumber: { in: keys } },
    orderBy: { at: "asc" },
    select: { guideNumber: true, toStatus: true, at: true },
  });
  // Estado a la hora de revisión = el último cambio visto hasta ese momento.
  const statusAt = new Map<string, string>();
  for (const c of changes) {
    const limit = checkAt.get(c.guideNumber);
    if (limit && c.at.getTime() <= limit.getTime()) statusAt.set(c.guideNumber, c.toStatus);
  }
  let prepared = 0;
  let generated = 0;
  for (const s of statusAt.values()) {
    if (isGenerated(s)) generated++;
    else if (isPrepared(s)) prepared++;
  }
  return { prepared, generated, checked: statusAt.size, pending: guides.length - checkAt.size };
}
