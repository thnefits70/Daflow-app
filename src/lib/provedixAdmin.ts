import { prisma } from "@/lib/prisma";
import { guideBrandsOf } from "@/lib/guideBrands";

// Sección "Provedix" del admin (pedido del usuario 2026-10-10): todo lo de
// la página pública provedix.com en un solo lugar, SOLO para el admin. Por
// ahora muestra lo que ya se lee de las guías (etapa 1); el resumen público,
// las visitas y la cartera de dropshippers se suman aquí en las etapas 2–4.

// Desde aquí se guardan los PDF de los cortes (antes no hay de dónde leer).
export const MARKET_DATA_FROM_DAY = "2026-09-23";
const OUR_BRANDS = ["MKT_PROVEDIX", "MKT_DAMIAN"];
const WINDOW_DAYS = 30;

type Count = { label: string; count: number };

export type ProvedixOverview = {
  progress: { read: number; total: number };
  windowFrom: string;
  guides: number;
  byBrand: Count[];
  cities: Count[];
  gender: { F: number; M: number; unknown: number };
  cod: { common: number | null; min: number | null; max: number | null; total: number; withValue: number };
  stores: { name: string; phone: string | null; count: number }[];
};

function topCounts(map: Map<string, number>, n: number): Count[] {
  return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([label, count]) => ({ label, count }));
}

export async function getProvedixOverview(): Promise<ProvedixOverview> {
  const fromDate = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const windowFrom = fromDate.toISOString().slice(0, 10) < MARKET_DATA_FROM_DAY ? MARKET_DATA_FROM_DAY : fromDate.toISOString().slice(0, 10);

  const [total, read, batches] = await Promise.all([
    prisma.fulfillmentRequestGuide.count({ where: { batch: { NOT: { fileUrls: { isEmpty: true } } } } }),
    prisma.fulfillmentRequestGuide.count({ where: { batch: { NOT: { fileUrls: { isEmpty: true } } }, marketReadAt: { not: null } } }),
    prisma.fulfillmentRequestBatch.findMany({
      where: { lot: { status: { in: ["SENT", "CLOSED"] }, day: { gte: windowFrom } } },
      select: {
        source: true,
        guides: {
          select: { guideNumber: true, codes: true, sender: true, senderPhone: true, destCity: true, buyerGender: true, codAmount: true, marketReadAt: true },
        },
        items: { select: { sourceCode: true, fromComboCode: true, warrantyGuide: true, catalogItem: { select: { bodega: true } } } },
      },
    }),
  ]);

  const brandOf = await guideBrandsOf(batches);
  // Garantías: no son una venta, no cuentan.
  const warranty = new Set(batches.flatMap((b) => b.items.map((i) => i.warrantyGuide?.toUpperCase()).filter(Boolean)));

  const byBrand = new Map<string, number>();
  const cities = new Map<string, number>();
  const gender = { F: 0, M: 0, unknown: 0 };
  const codCounts = new Map<number, number>();
  const cods: number[] = [];
  const stores = new Map<string, { name: string; phone: string | null; count: number }>();
  let guides = 0;

  for (const b of batches) {
    for (const g of b.guides) {
      const brand = brandOf.get(g.guideNumber);
      if (!brand || !OUR_BRANDS.includes(brand) || !g.marketReadAt || warranty.has(g.guideNumber.toUpperCase())) continue;
      guides++;
      byBrand.set(brand, (byBrand.get(brand) ?? 0) + 1);
      if (g.destCity) cities.set(g.destCity, (cities.get(g.destCity) ?? 0) + 1);
      if (g.buyerGender === "F") gender.F++;
      else if (g.buyerGender === "M") gender.M++;
      else gender.unknown++;
      if (g.codAmount != null) {
        const v = Number(g.codAmount);
        cods.push(v);
        codCounts.set(v, (codCounts.get(v) ?? 0) + 1);
      }
      // La misma tienda con o sin celular en distintas transportadoras se
      // junta por nombre (Servientrega/Urbano no traen el celular).
      if (g.sender) {
        const key = g.sender.trim().toUpperCase();
        const s = stores.get(key) ?? { name: g.sender.trim(), phone: null, count: 0 };
        s.count++;
        s.phone ??= g.senderPhone;
        stores.set(key, s);
      }
    }
  }

  return {
    progress: { read, total },
    windowFrom,
    guides,
    byBrand: topCounts(byBrand, 5),
    cities: topCounts(cities, 10),
    gender,
    cod: {
      common: [...codCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null,
      min: cods.length ? Math.min(...cods) : null,
      max: cods.length ? Math.max(...cods) : null,
      total: cods.reduce((a, v) => a + v, 0),
      withValue: cods.length,
    },
    stores: [...stores.values()].sort((a, b) => b.count - a.count).slice(0, 15),
  };
}
