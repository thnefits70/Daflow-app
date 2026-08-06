import { prisma } from "@/lib/prisma";

// "YYYY-MM" en hora de Ecuador (UTC-5) — confirmado 2026-08-06: mismo tipo de
// cálculo de período que usa PaymentReminder, solo que acá corre en el
// servidor para armar "pendientes de registrar este mes".
export function currentPeriod(): string {
  const now = new Date(Date.now() - 5 * 60 * 60 * 1000);
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

export type AdminPaymentTemplateDTO = {
  id: string;
  motivo: string;
  isActive: boolean;
};

export async function getAdminPaymentTemplates(): Promise<AdminPaymentTemplateDTO[]> {
  return prisma.adminPaymentTemplate.findMany({
    where: { isActive: true },
    orderBy: { motivo: "asc" },
    select: { id: true, motivo: true, isActive: true },
  });
}

// Confirmado 2026-08-06: la reaparición mensual es perezosa — no se crea
// ninguna fila sola. Esto solo calcula, para el período actual, qué
// plantillas activas todavía no tienen una AdminPaymentRequest — es lo que
// arma el bloque "Pendientes de registrar este mes" en el panel de Nairoby.
export async function getAdminPaymentTemplatesPendingThisMonth(): Promise<AdminPaymentTemplateDTO[]> {
  const period = currentPeriod();
  const templates = await prisma.adminPaymentTemplate.findMany({
    where: { isActive: true },
    select: { id: true, motivo: true, isActive: true, requests: { where: { period }, select: { id: true } } },
  });
  return templates.filter((t) => t.requests.length === 0).map((t) => ({ id: t.id, motivo: t.motivo, isActive: t.isActive }));
}

export type StaleAdminPaymentPush = { ownerId: string; title: string; body: string; url: string };

// Mismo espíritu que getStalePurchaseRequestPushes (src/lib/purchases.ts) —
// si el admin lleva más de 24h sin pagar una solicitud, se le vuelve a
// avisar cada día que sigue pendiente dentro del mismo cron diario.
export async function getStaleAdminPaymentPushes(): Promise<StaleAdminPaymentPush[]> {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const pending = await prisma.adminPaymentRequest.findMany({
    where: { status: "PENDING_PAYMENT", createdAt: { lt: cutoff } },
    select: { id: true, motivo: true, monto: true },
  });
  return pending.map((r) => ({
    ownerId: "admin",
    title: "⏰ Pago administrativo sin pagar hace más de 24h",
    body: `${r.motivo} — $${r.monto.toFixed(2)}`,
    url: "/admin",
  }));
}
