// Server-only (prisma). Servicio Postventa — confirmed 2026-07-22:
// - Detailed per-store evaluations (name, comments, individual scores) are
//   only for Nairoby (FIN leader) / admin to manage — real operational/
//   relationship data, not for company-wide display.
// - The MONTHLY AGGREGATE (average loyalty + driver scores across every
//   store evaluated that month) is public to everyone — shown in KPIs
//   Generales and on Inicio, so the whole company can see what's improving.
import { prisma } from "@/lib/prisma";

export type StoreFeedbackEvaluationDTO = {
  id: string;
  period: string;
  loyaltyScore: number;
  fulfillmentScore: number;
  qualityScore: number;
  stockScore: number;
  responseTimeScore: number;
  commercialTermsScore: number;
  communicationScore: number;
  comment: string;
  evaluatedByName: string | null;
  evaluatedAt: string;
};

export type StoreDTO = {
  id: string;
  name: string;
  contactName: string | null;
  contactPhone: string | null;
  isActive: boolean;
  evaluations: StoreFeedbackEvaluationDTO[];
};

export async function getStoreFeedbackData(): Promise<StoreDTO[]> {
  const stores = await prisma.store.findMany({
    orderBy: { order: "asc" },
    include: {
      evaluations: { orderBy: { period: "desc" }, include: { evaluatedBy: { select: { name: true } } } },
    },
  });

  return stores.map((s) => ({
    id: s.id,
    name: s.name,
    contactName: s.contactName,
    contactPhone: s.contactPhone,
    isActive: s.isActive,
    evaluations: s.evaluations.map((e) => ({
      id: e.id,
      period: e.period,
      loyaltyScore: e.loyaltyScore,
      fulfillmentScore: e.fulfillmentScore,
      qualityScore: e.qualityScore,
      stockScore: e.stockScore,
      responseTimeScore: e.responseTimeScore,
      commercialTermsScore: e.commercialTermsScore,
      communicationScore: e.communicationScore,
      comment: e.comment,
      evaluatedByName: e.evaluatedBy?.name ?? null,
      evaluatedAt: e.evaluatedAt.toISOString(),
    })),
  }));
}

export type StoreFeedbackAggregate = {
  period: string;
  storeCount: number;
  avgLoyaltyScore: number;
  avgFulfillmentScore: number;
  avgQualityScore: number;
  avgStockScore: number;
  avgResponseTimeScore: number;
  avgCommercialTermsScore: number;
  avgCommunicationScore: number;
  prevAvgLoyaltyScore: number | null;
};

function avg(values: number[]): number {
  return values.length === 0 ? 0 : Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10;
}

async function aggregateForPeriod(period: string) {
  const rows = await prisma.storeFeedbackEvaluation.findMany({ where: { period } });
  if (rows.length === 0) return null;
  return {
    period,
    storeCount: rows.length,
    avgLoyaltyScore: avg(rows.map((r) => r.loyaltyScore)),
    avgFulfillmentScore: avg(rows.map((r) => r.fulfillmentScore)),
    avgQualityScore: avg(rows.map((r) => r.qualityScore)),
    avgStockScore: avg(rows.map((r) => r.stockScore)),
    avgResponseTimeScore: avg(rows.map((r) => r.responseTimeScore)),
    avgCommercialTermsScore: avg(rows.map((r) => r.commercialTermsScore)),
    avgCommunicationScore: avg(rows.map((r) => r.communicationScore)),
  };
}

// Public — the latest period that actually has data, plus the prior
// period's loyalty average (if any) so callers can show a trend.
export async function getStoreFeedbackAggregate(): Promise<StoreFeedbackAggregate | null> {
  const latest = await prisma.storeFeedbackEvaluation.findFirst({ orderBy: { period: "desc" }, select: { period: true } });
  if (!latest) return null;

  const current = await aggregateForPeriod(latest.period);
  if (!current) return null;

  const [y, m] = latest.period.split("-").map(Number);
  const prevDate = new Date(Date.UTC(y, m - 2, 1));
  const prevPeriod = `${prevDate.getUTCFullYear()}-${String(prevDate.getUTCMonth() + 1).padStart(2, "0")}`;
  const prev = await aggregateForPeriod(prevPeriod);

  return { ...current, prevAvgLoyaltyScore: prev?.avgLoyaltyScore ?? null };
}
