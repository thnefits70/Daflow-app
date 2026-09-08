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
// Se lee de LunchWeekSubmission (la etapa de registro) y no de
// AdminPaymentRequest, porque una semana recién registrada todavía no tiene
// AdminPaymentRequest — recién se crea cuando Nairoby la verifica.
export async function getLunchDefaults(): Promise<LunchDefaultsDTO> {
  const last = await prisma.lunchWeekSubmission.findFirst({
    orderBy: { weekEnd: "desc" },
    select: { payeeId: true, bankAccountId: true, weekEnd: true },
  });
  let suggestedWeekStart: string | null = null;
  if (last?.weekEnd) {
    const next = new Date(last.weekEnd);
    next.setUTCDate(next.getUTCDate() + 1);
    suggestedWeekStart = next.toISOString().slice(0, 10);
  }
  return { payeeId: last?.payeeId ?? null, bankAccountId: last?.bankAccountId ?? null, suggestedWeekStart };
}

const MONTH_NAMES_ES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
function formatDateEs(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} de ${MONTH_NAMES_ES[m - 1]} del ${y}`;
}

// Compartido entre el registro (Daniel) y la verificación (Nairoby) — el
// motivo que termina en el AdminPaymentRequest debe ser idéntico al que se
// mostró cuando se registró la semana.
export function formatLunchMotivo(weekStartIso: string, weekEndIso: string, lunchCount: number, pricePerLunch: number): string {
  return `Almuerzos semana del ${formatDateEs(weekStartIso)} al ${formatDateEs(weekEndIso)} — ${lunchCount} almuerzos x $${pricePerLunch.toFixed(2)}`;
}
