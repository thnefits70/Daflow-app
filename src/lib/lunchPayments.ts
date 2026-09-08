import { prisma } from "@/lib/prisma";

// Fila única — mismo patrón que PayrollSettings (ver src/app/api/payroll/settings/route.ts).
const SETTINGS_ID = "lunch-payment-settings-singleton";

export type LunchPaymentSettingsDTO = { pricePerLunch: number };

export async function getLunchPaymentSettings(): Promise<LunchPaymentSettingsDTO> {
  const settings = await prisma.lunchPaymentSettings.findUnique({ where: { id: SETTINGS_ID } });
  return { pricePerLunch: settings?.pricePerLunch ?? 2.5 };
}

export async function updateLunchPricePerLunch(pricePerLunch: number, updatedById: string | null) {
  return prisma.lunchPaymentSettings.upsert({
    where: { id: SETTINGS_ID },
    update: { pricePerLunch, updatedById },
    create: { id: SETTINGS_ID, pricePerLunch, updatedById },
  });
}

export type LunchDefaultsDTO = {
  payeeId: string | null;
  bankAccountId: string | null;
  suggestedWeekStart: string | null; // día siguiente a la última semana registrada, "YYYY-MM-DD"
};

// Confirmado 2026-09-08: para no hacer que Daniel vuelva a elegir a quién
// pagar cada semana (siempre es el mismo restaurante) ni calcule a mano cuál
// semana sigue — se sugiere en base al último registro, pero queda editable.
export async function getLunchDefaults(): Promise<LunchDefaultsDTO> {
  const last = await prisma.adminPaymentRequest.findFirst({
    where: { lunchWeekEnd: { not: null } },
    orderBy: { lunchWeekEnd: "desc" },
    select: { payeeId: true, bankAccountId: true, lunchWeekEnd: true },
  });
  let suggestedWeekStart: string | null = null;
  if (last?.lunchWeekEnd) {
    const next = new Date(last.lunchWeekEnd);
    next.setUTCDate(next.getUTCDate() + 1);
    suggestedWeekStart = next.toISOString().slice(0, 10);
  }
  return { payeeId: last?.payeeId ?? null, bankAccountId: last?.bankAccountId ?? null, suggestedWeekStart };
}
