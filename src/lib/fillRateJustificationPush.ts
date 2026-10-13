import { prisma } from "@/lib/prisma";
import { notifyOwner } from "@/lib/notifications";
import { getDisabledTypes } from "@/lib/pushPreferences";
import { fillRateJustificationIsDue } from "@/lib/fillRateJustificationDue";

// Pedido de Daniel 2026-10-13: el aviso de "explica el Fill Rate" le llega
// el sábado a las 12:00 (Ecuador), justo cuando la semana ya se le pide
// (fillRateJustificationDue.ts). Lo dispara el barrido del mediodía
// (cron inventory-auto-flows) solo los sábados; los demás días sigue en el
// resumen de las 8:00 si quedó sin explicar. Respeta si apagó ese tipo de
// aviso (mismo tipo que el resumen diario).
const TYPE = "fillrate_justificacion_pendiente";

export async function sendSaturdayFillRateJustificationPush(now: Date = new Date()): Promise<number> {
  if (now.toLocaleDateString("en-US", { weekday: "short", timeZone: "America/Guayaquil" }) !== "Sat") return 0;

  const depts = await prisma.department.findMany({ where: { trackWeeklyMetric: true }, select: { id: true } });
  let sent = 0;
  for (const dept of depts) {
    const recent = await prisma.weeklyMetricRecord.findMany({
      where: { deptId: dept.id, prepared: { not: null }, generated: { not: null }, outOfStock: { not: null } },
      orderBy: { week: "desc" },
      take: 2,
    });
    const record = recent.find((r) => fillRateJustificationIsDue(r.week, now));
    if (!record || record.fillRateJustification) continue;
    const total = record.value + (record.prepared ?? 0) + (record.generated ?? 0) + (record.outOfStock ?? 0);
    if (total === 0) continue;
    const pct = Math.round((record.value / total) * 100);
    if (pct >= 95) continue;

    const leaders = await prisma.user.findMany({ where: { isLeader: true, isActive: true, leadsDeptId: dept.id }, select: { id: true } });
    for (const l of leaders) {
      if ((await getDisabledTypes(l.id)).has(TYPE)) continue;
      await notifyOwner(l.id, {
        title: "Fill Rate en alerta — falta tu explicación",
        body: `La semana ${record.week.replace(/^(\d{4})-W(\d+)$/, "$2 · $1")} quedó en ${pct}%. Explícale al equipo qué pasó.`,
        url: "/area/workspace?tab=semanal",
      });
      sent++;
    }
  }
  return sent;
}
