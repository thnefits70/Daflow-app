import { prisma } from "@/lib/prisma";
import { computeCostUsd } from "@/lib/aiPricing";

export type AiUsageFeature = "nancy" | "rutas_conocimiento" | "control_compras_cotizacion" | "control_compras_catalogo" | "control_compras_comprobante_pago" | "control_compras_orden_compra" | "caja_chica_comprobante" | "control_inventario_comprobante";

const FEATURE_LABELS: Record<AiUsageFeature, string> = {
  nancy: "Nancy · chat financiero",
  rutas_conocimiento: "Rutas de conocimiento · generar preguntas",
  control_compras_cotizacion: "Control de Compras · verificar cotización",
  control_compras_catalogo: "Control de Compras · chequeo de catálogo",
  control_compras_comprobante_pago: "Control de Compras · verificar comprobante de pago",
  control_compras_orden_compra: "Control de Compras · verificar orden de compra",
  caja_chica_comprobante: "Caja Chica · verificar comprobante",
  control_inventario_comprobante: "Control de Inventario · verificar captura de valor",
};

// Confirmado 2026-07-29: no debe poder tumbar el flujo principal (Nancy o la
// generación de preguntas) si este registro falla por lo que sea — el gasto
// de IA es un panel de control aparte, no una dependencia dura.
export async function logAiUsage(params: {
  feature: AiUsageFeature;
  model: string;
  actorId: string;
  deptId?: string;
  inputTokens: number;
  outputTokens: number;
}) {
  try {
    const costUsd = computeCostUsd(params.model, params.inputTokens, params.outputTokens);
    await prisma.aiUsageLog.create({
      data: {
        feature: params.feature,
        model: params.model,
        actorId: params.actorId,
        deptId: params.deptId,
        inputTokens: params.inputTokens,
        outputTokens: params.outputTokens,
        costUsd,
      },
    });
  } catch (err) {
    console.error("No se pudo registrar el gasto de IA:", err);
  }
}

function startOfUtcDay(d: Date) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

export type AiSpendOverview = {
  today: number;
  week: number;
  month: number;
  monthCalls: number;
  projectedMonth: number;
  byFeature: { feature: string; label: string; amount: number }[];
  byActor: { actorId: string; actorName: string; deptName: string | null; feature: string; label: string; calls: number; amount: number }[];
  daily: { date: string; amount: number }[];
};

export async function getAiSpendOverview(): Promise<AiSpendOverview> {
  const now = new Date();
  const todayStart = startOfUtcDay(now);
  const weekStart = new Date(todayStart.getTime() - 6 * 86400000);
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

  const [monthLogs, deptRows, userRows] = await Promise.all([
    prisma.aiUsageLog.findMany({
      where: { createdAt: { gte: monthStart } },
      select: { feature: true, model: true, actorId: true, deptId: true, costUsd: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    }),
    prisma.department.findMany({ select: { id: true, name: true } }),
    prisma.user.findMany({ select: { id: true, name: true } }),
  ]);

  const deptNameById = new Map(deptRows.map((d) => [d.id, d.name]));
  const userNameById = new Map(userRows.map((u) => [u.id, u.name]));
  const actorName = (actorId: string) => (actorId === "admin" ? "Andrés (admin)" : userNameById.get(actorId) ?? "Usuario eliminado");

  let today = 0;
  let week = 0;
  let month = 0;
  const byFeatureMap = new Map<string, number>();
  const byActorMap = new Map<string, { actorId: string; deptName: string | null; feature: string; calls: number; amount: number }>();
  const dailyMap = new Map<string, number>();

  for (const log of monthLogs) {
    month += log.costUsd;
    byFeatureMap.set(log.feature, (byFeatureMap.get(log.feature) ?? 0) + log.costUsd);

    if (log.createdAt >= todayStart) today += log.costUsd;
    if (log.createdAt >= weekStart) week += log.costUsd;

    const dayKey = startOfUtcDay(log.createdAt).toISOString().slice(0, 10);
    dailyMap.set(dayKey, (dailyMap.get(dayKey) ?? 0) + log.costUsd);

    const actorKey = `${log.actorId}::${log.feature}`;
    const existing = byActorMap.get(actorKey);
    if (existing) {
      existing.calls += 1;
      existing.amount += log.costUsd;
    } else {
      byActorMap.set(actorKey, {
        actorId: log.actorId,
        deptName: log.deptId ? (deptNameById.get(log.deptId) ?? null) : null,
        feature: log.feature,
        calls: 1,
        amount: log.costUsd,
      });
    }
  }

  const daysElapsed = Math.floor((todayStart.getTime() - monthStart.getTime()) / 86400000) + 1;
  const projectedMonth = daysElapsed > 0 ? (month / daysElapsed) * new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate() : month;

  const byFeature = [...byFeatureMap.entries()]
    .map(([feature, amount]) => ({ feature, label: FEATURE_LABELS[feature as AiUsageFeature] ?? feature, amount }))
    .sort((a, b) => b.amount - a.amount);

  const byActor = [...byActorMap.values()]
    .map((r) => ({
      actorId: r.actorId,
      actorName: actorName(r.actorId),
      deptName: r.deptName,
      feature: r.feature,
      label: FEATURE_LABELS[r.feature as AiUsageFeature] ?? r.feature,
      calls: r.calls,
      amount: r.amount,
    }))
    .sort((a, b) => b.amount - a.amount);

  const daily = [...dailyMap.entries()].map(([date, amount]) => ({ date, amount })).sort((a, b) => a.date.localeCompare(b.date));

  return { today, week, month, monthCalls: monthLogs.length, projectedMonth, byFeature, byActor, daily };
}
