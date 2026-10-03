import { prisma } from "@/lib/prisma";
import { isAutoWarrantyMonth, WARRANTY_LAST_MANUAL_MONTH } from "@/lib/warrantyKpiConstants";

// Guayaquil es UTC-5 todo el año (sin horario de verano).
const GYE_OFFSET_MS = 5 * 60 * 60 * 1000;

export function guayaquilMonth(d: Date): string {
  const g = new Date(d.getTime() - GYE_OFFSET_MS);
  return `${g.getUTCFullYear()}-${String(g.getUTCMonth() + 1).padStart(2, "0")}`;
}

// Pedido del usuario 2026-09-30: el KPI de Garantías se llena solo con los
// cortes — cada guía de garantía cuenta una vez en el mes en que se subió,
// con el motivo que marcó Yair. Recalcula el mes completo (total + motivos)
// para que un reproceso nunca duplique. Los meses antes de octubre 2026 no
// se tocan (quedan como se cargaron a mano).
export async function syncWarrantyMonth(month: string): Promise<void> {
  if (!isAutoWarrantyMonth(month)) return;
  const [y, m] = month.split("-").map(Number);
  const from = new Date(Date.UTC(y, m - 1, 1) + GYE_OFFSET_MS);
  const to = new Date(Date.UTC(y, m, 1) + GYE_OFFSET_MS);

  const rows = await prisma.fulfillmentRequestItem.findMany({
    where: { warrantyGuide: { not: null }, batch: { requestedAt: { gte: from, lt: to } } },
    select: { warrantyGuide: true, warrantyCategoryId: true },
  });
  // Una guía de garantía puede traer varias filas (combo): cuenta una vez.
  const categoryByGuide = new Map<string, string | null>();
  for (const r of rows) {
    const prev = categoryByGuide.get(r.warrantyGuide!);
    if (prev === undefined || (prev === null && r.warrantyCategoryId)) categoryByGuide.set(r.warrantyGuide!, r.warrantyCategoryId);
  }
  const countByCategory = new Map<string, number>();
  for (const c of categoryByGuide.values()) if (c) countByCategory.set(c, (countByCategory.get(c) ?? 0) + 1);

  await prisma.$transaction([
    prisma.warrantyMonthTotal.upsert({ where: { month }, create: { month, total: categoryByGuide.size }, update: { total: categoryByGuide.size } }),
    prisma.warrantyCategoryMonthCount.deleteMany({ where: { month, categoryId: { notIn: [...countByCategory.keys()] } } }),
    ...[...countByCategory.entries()].map(([categoryId, count]) =>
      prisma.warrantyCategoryMonthCount.upsert({
        where: { month_categoryId: { month, categoryId } },
        create: { month, categoryId, count },
        update: { count },
      })
    ),
  ]);
}

// Pedido del usuario 2026-10-03: septiembre (el último mes a mano) cuenta
// como cargado solo con el total Y al menos un motivo — antes bastaba el
// total, y al guardarlo la sección desaparecía sin dejar poner los motivos.
export async function isLastManualWarrantyMonthDone(): Promise<boolean> {
  const [total, counts] = await Promise.all([
    prisma.warrantyMonthTotal.findUnique({ where: { month: WARRANTY_LAST_MANUAL_MONTH }, select: { id: true } }),
    prisma.warrantyCategoryMonthCount.count({ where: { month: WARRANTY_LAST_MANUAL_MONTH } }),
  ]);
  return !!total && counts > 0;
}
