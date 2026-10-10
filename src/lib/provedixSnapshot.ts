import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import { ecuadorDay, resolveGuideLines } from "@/lib/fulfillmentGuides";
import { labelLineUnits, type ParsedGuidesLine } from "@/lib/dropiGuidesPdf";
import { guideBrandsOf } from "@/lib/guideBrands";

// Etapa 2 de provedix.com (pedido del usuario 2026-10-10): el resumen por
// producto que verá la página pública. Se calcula UNA vez al día (cron) y se
// guarda listo en ProvedixSnapshot — la página solo lee ese resumen, nunca
// las guías, así aguanta muchas visitas y nunca puede mostrar datos de una
// persona.
//
// Decisiones del usuario: base = producto suelto (ID de Dropi = justCode),
// sumando lo que salió dentro de combos; combos reales vendidos con su ID;
// ventas y dinero en RANGOS; 7 días de retraso; solo Provedix e Importadora
// Damián; sin garantías ni guías anuladas. Ciudades con pocos pedidos van a
// "Otras" para que nadie deduzca quién compró. Sin nombres de tiendas.

export const SNAPSHOT_DELAY_DAYS = 7;
const WINDOW_DAYS = 30;
const OUR_BRANDS = new Set(["MKT_PROVEDIX", "MKT_DAMIAN"]);
const MIN_CITY_GUIDES = 3;
const MIN_GENDER_GUIDES = 5;
// La devolución llega semanas después: se mide en guías que salieron hace
// 15–45 días, si no los pedidos recientes parecerían todos entregados.
const DELIVERY_FROM_DAYS = 45;
const DELIVERY_TO_DAYS = 15;
const MIN_DELIVERY_GUIDES = 20;

const UNIT_RANGES = [1, 10, 25, 50, 100, 200, 300, 500, 1000];
const MONEY_STEPS = [50, 100, 250, 500, 1000, 2500, 5000, 10000, 25000, 50000, 100000];

export function unitsRange(n: number): string {
  if (n <= 0) return "0";
  for (let i = UNIT_RANGES.length - 1; i >= 0; i--) {
    if (n >= UNIT_RANGES[i]) return i === UNIT_RANGES.length - 1 ? `Más de ${UNIT_RANGES[i].toLocaleString("es-EC")}` : `${UNIT_RANGES[i]}–${UNIT_RANGES[i + 1]}`;
  }
  return "1–10";
}

export function moneyRange(n: number): string {
  let best: number | null = null;
  for (const s of MONEY_STEPS) if (n >= s) best = s;
  return best == null ? "Menos de $50" : `Más de $${best.toLocaleString("es-EC")}`;
}

export type SnapshotOffer = { units: number; price: number; share: number };
export type SnapshotCombo = { code: string; name: string; photos: string[]; unitsRange: string; price: number | null };
export type SnapshotProduct = {
  code: string; // ID de Dropi del producto suelto
  name: string;
  brand: "MKT_PROVEDIX" | "MKT_DAMIAN";
  photo: string | null;
  unitsRange: string; // 30 días
  soldRange: string; // $ cobrado en 30 días
  trend: "up" | "down" | "flat";
  offers: SnapshotOffer[]; // precio al público más común por cantidad (suelto)
  priceMin: number | null;
  priceMax: number | null;
  dropiPrice: number | null;
  marginApprox: number | null; // oferta más común − precio Dropi × unidades
  qtyMix: { one: number; two: number; threePlus: number } | null; // % de pedidos sueltos
  cities: { city: string; share: number }[];
  women: number | null; // % mujeres (aprox. por el nombre)
  deliveryRate: number | null; // % entregado (sin devolución)
  combos: SnapshotCombo[];
  rank: number;
};
export type ProvedixSnapshotData = {
  day: string;
  windowFrom: string;
  windowTo: string;
  products: SnapshotProduct[];
  guides: number;
};

function shiftDay(day: string, days: number): string {
  const d = new Date(`${day}T12:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

type LabelProduct = { code: string | null; name: string; qty: number; physical?: boolean };

const asLine = (code: string): ParsedGuidesLine => ({ code, name: "", quantity: 1, byCarrier: {}, variants: [], labelUnits: 0 });

type ProductAcc = {
  units: number;
  unitsLast7: number;
  unitsPrev7: number;
  sold: number; // solo de guías con valor leído
  unitsWithCod: number;
  guides: Set<string>;
  offers: Map<string, number>; // "units|price" → pedidos (guías de solo este producto)
  prices: number[];
  qty: { one: number; two: number; threePlus: number };
  cities: Map<string, number>;
  cityGuides: number;
  women: number;
  men: number;
  combos: Map<string, { units: number; prices: Map<number, number> }>;
};

const newAcc = (): ProductAcc => ({
  units: 0,
  unitsLast7: 0,
  unitsPrev7: 0,
  sold: 0,
  unitsWithCod: 0,
  guides: new Set(),
  offers: new Map(),
  prices: [],
  qty: { one: 0, two: 0, threePlus: 0 },
  cities: new Map(),
  cityGuides: 0,
  women: 0,
  men: 0,
  combos: new Map(),
});

function percentile(sorted: number[], p: number): number {
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * p)))];
}

function topKey<K>(m: Map<K, number>): K | null {
  let best: K | null = null;
  let n = -1;
  for (const [k, v] of m) if (v > n) [best, n] = [k, v];
  return best;
}

export async function buildProvedixSnapshot(today = ecuadorDay(new Date())): Promise<ProvedixSnapshotData> {
  const windowTo = shiftDay(today, -SNAPSHOT_DELAY_DAYS);
  const windowFrom = shiftDay(windowTo, -(WINDOW_DAYS - 1));
  const last7From = shiftDay(windowTo, -6);
  const prev7From = shiftDay(windowTo, -13);
  const deliveryFrom = shiftDay(today, -DELIVERY_FROM_DAYS);
  const deliveryTo = shiftDay(today, -DELIVERY_TO_DAYS);
  const fetchFrom = deliveryFrom < windowFrom ? deliveryFrom : windowFrom;

  const [batches, cancelled, returned] = await Promise.all([
    prisma.fulfillmentRequestBatch.findMany({
      where: { lot: { status: { in: ["SENT", "CLOSED"] }, day: { gte: shiftDay(fetchFrom, -3), lte: windowTo > deliveryTo ? windowTo : deliveryTo } } },
      select: {
        source: true,
        lot: { select: { day: true } },
        guides: { select: { guideNumber: true, codes: true, labelProducts: true, manifestDay: true, destCity: true, buyerGender: true, codAmount: true } },
        items: { select: { sourceCode: true, fromComboCode: true, warrantyGuide: true, catalogItem: { select: { bodega: true } } } },
      },
    }),
    prisma.cancelledGuideReport.findMany({ where: { NOT: { reallyCancelled: false } }, select: { guideNumber: true } }),
    prisma.merchandiseReentryGuide.findMany({ select: { guideNumber: true } }),
  ]);

  const brandOf = await guideBrandsOf(batches);
  const warranty = new Set(batches.flatMap((b) => b.items.map((i) => i.warrantyGuide?.toUpperCase()).filter((g): g is string => !!g)));
  const cancelledSet = new Set(cancelled.map((c) => c.guideNumber.toUpperCase()));
  const returnedSet = new Set(returned.map((r) => r.guideNumber.toUpperCase()));

  type G = { number: string; day: string; products: LabelProduct[]; city: string | null; gender: string | null; cod: number | null };
  const guides: G[] = [];
  for (const b of batches) {
    for (const g of b.guides) {
      const key = g.guideNumber.toUpperCase();
      if (!OUR_BRANDS.has(brandOf.get(g.guideNumber) ?? "") || warranty.has(key) || cancelledSet.has(key)) continue;
      const products = Array.isArray(g.labelProducts) ? (g.labelProducts as LabelProduct[]).filter((p) => p.code && p.qty > 0) : [];
      if (products.length === 0) continue;
      guides.push({ number: key, day: g.manifestDay ?? b.lot!.day, products, city: g.destCity, gender: g.buyerGender, cod: g.codAmount == null ? null : Number(g.codAmount) });
    }
  }

  // Código de la etiqueta → producto suelto o combo (con su receta).
  const codes = [...new Set(guides.flatMap((g) => g.products.map((p) => p.code!)))];
  const resolved = await resolveGuideLines(codes.map(asLine), { skipSuggestions: true });
  const byCode = new Map(resolved.map((r) => [r.code, r.resolution]));

  const acc = new Map<string, ProductAcc>(); // catalogItemId
  const delivery = new Map<string, { sent: number; returned: number }>();
  const comboNames = new Map<string, string>();
  let windowGuides = 0;

  for (const g of guides) {
    const inWindow = g.day >= windowFrom && g.day <= windowTo;
    const inDelivery = g.day >= deliveryFrom && g.day <= deliveryTo;
    if (!inWindow && !inDelivery) continue;
    if (inWindow) windowGuides++;
    // Unidades por línea de la etiqueta y a qué productos sueltos llegan.
    const lines = g.products.map((p) => {
      const units = p.physical ? p.qty : labelLineUnits(p.name, p.qty);
      const r = byCode.get(p.code!);
      const parts: { id: string; units: number }[] =
        r?.kind === "product" ? [{ id: r.catalogItem.id, units }] : r?.kind === "combo" ? r.components.map((c) => ({ id: c.catalogItem.id, units: units * c.quantity })) : [];
      // Un ID alterno de combo se cuenta como su combo madre (el de nuestra marca).
      const code = r?.kind === "combo" ? r.comboCode : p.code!;
      if (r?.kind === "combo") comboNames.set(code, r.label ?? r.components.map((c) => c.catalogItem.name).join(" + "));
      return { code, combo: r?.kind === "combo", units, parts };
    });
    const touched = new Set(lines.flatMap((l) => l.parts.map((p) => p.id)));

    if (inDelivery) {
      for (const id of touched) {
        const d = delivery.get(id) ?? { sent: 0, returned: 0 };
        d.sent++;
        if (returnedSet.has(g.number)) d.returned++;
        delivery.set(id, d);
      }
    }
    if (!inWindow) continue;

    // El valor cobrado se reparte entre las líneas del pedido (y dentro de un
    // combo, entre sus productos por cantidad) — es aproximado, va en rango.
    const share = g.cod != null && lines.length ? g.cod / lines.length : 0;
    for (const l of lines) {
      const totalParts = l.parts.reduce((a, p) => a + p.units, 0) || 1;
      for (const part of l.parts) {
        const a = acc.get(part.id) ?? newAcc();
        acc.set(part.id, a);
        a.units += part.units;
        if (g.day >= last7From) a.unitsLast7 += part.units;
        else if (g.day >= prev7From) a.unitsPrev7 += part.units;
        if (g.cod != null) {
          a.sold += share * (part.units / totalParts);
          a.unitsWithCod += part.units;
        }
        if (l.combo) {
          const c = a.combos.get(l.code) ?? { units: 0, prices: new Map() };
          c.units += l.units;
          if (lines.length === 1 && g.cod != null) c.prices.set(g.cod, (c.prices.get(g.cod) ?? 0) + 1);
          a.combos.set(l.code, c);
        }
      }
    }
    // Pedido de un solo producto suelto: de ahí sale el precio al público y
    // cuántas unidades se piden.
    if (lines.length === 1 && !lines[0].combo && lines[0].parts.length === 1) {
      const a = acc.get(lines[0].parts[0].id)!;
      const u = lines[0].units;
      if (u === 1) a.qty.one++;
      else if (u === 2) a.qty.two++;
      else a.qty.threePlus++;
      if (g.cod != null) {
        a.offers.set(`${u}|${g.cod}`, (a.offers.get(`${u}|${g.cod}`) ?? 0) + 1);
        a.prices.push(g.cod);
      }
    }
    for (const id of touched) {
      const a = acc.get(id)!;
      if (a.guides.has(g.number)) continue;
      a.guides.add(g.number);
      if (g.city) {
        a.cities.set(g.city, (a.cities.get(g.city) ?? 0) + 1);
        a.cityGuides++;
      }
      if (g.gender === "F") a.women++;
      else if (g.gender === "M") a.men++;
    }
  }

  const ids = [...acc.keys()];
  const items = await prisma.purchaseCatalogItem.findMany({
    where: { id: { in: ids }, bodega: { in: ["MKT_PROVEDIX", "MKT_DAMIAN"] }, justCode: { not: null } },
    select: { id: true, name: true, justCode: true, bodega: true, photos: true, dropiPriceRef: true },
  });
  const itemById = new Map(items.map((i) => [i.id, i]));
  const comboCodes = [...new Set([...acc.values()].flatMap((a) => [...a.combos.keys()]))];
  const comboPhotos = new Map<string, string[]>();
  if (comboCodes.length) {
    const combos = await prisma.dropiCombo.findMany({
      where: { code: { in: comboCodes } },
      select: { code: true, label: true, components: { select: { catalogItem: { select: { photos: true } } } } },
    });
    for (const c of combos) {
      comboPhotos.set(c.code, c.components.map((x) => x.catalogItem.photos[0]).filter((p): p is string => !!p));
      if (c.label) comboNames.set(c.code, c.label);
    }
  }

  // Unidades exactas solo para ordenar: nunca se guardan.
  const ranked: { units: number; product: SnapshotProduct }[] = [];
  for (const [id, a] of acc) {
    const item = itemById.get(id);
    if (!item || a.units <= 0) continue;
    const offersTotal = [...a.offers.values()].reduce((x, y) => x + y, 0);
    const offers = [...a.offers.entries()]
      .sort((x, y) => y[1] - x[1])
      .slice(0, 3)
      .map(([k, n]) => {
        const [u, p] = k.split("|").map(Number);
        return { units: u, price: p, share: Math.round((n / offersTotal) * 100) };
      });
    const sorted = [...a.prices].sort((x, y) => x - y);
    const top = offers[0];
    const qtyTotal = a.qty.one + a.qty.two + a.qty.threePlus;
    const knownGender = a.women + a.men;
    // Ciudades: solo las que tienen al menos 3 pedidos; el resto, "Otras".
    const cityRows = [...a.cities.entries()].sort((x, y) => y[1] - x[1]);
    const shown = cityRows.filter(([, n]) => n >= MIN_CITY_GUIDES).slice(0, 5);
    const cities = shown.map(([city, n]) => ({ city, share: Math.round((n / a.cityGuides) * 100) }));
    const rest = a.cityGuides - shown.reduce((x, [, n]) => x + n, 0);
    if (cities.length && rest > 0) cities.push({ city: "Otras", share: Math.round((rest / a.cityGuides) * 100) });
    const d = delivery.get(id);
    const growth = a.unitsPrev7 > 0 ? a.unitsLast7 / a.unitsPrev7 : a.unitsLast7 > 0 ? 2 : 1;
    ranked.push({ units: a.units, product: {
      code: item.justCode!,
      name: item.name,
      brand: item.bodega as SnapshotProduct["brand"],
      photo: item.photos[0] ?? null,
      unitsRange: unitsRange(a.units),
      // Guías viejas todavía sin valor leído: se completa con el precio
      // promedio por unidad de las que sí lo tienen.
      soldRange: moneyRange(a.unitsWithCod > 0 ? (a.sold / a.unitsWithCod) * a.units : 0),
      trend: growth >= 1.3 ? "up" : growth <= 0.7 ? "down" : "flat",
      offers,
      priceMin: sorted.length >= 5 ? percentile(sorted, 0.1) : sorted[0] ?? null,
      priceMax: sorted.length >= 5 ? percentile(sorted, 0.9) : sorted[sorted.length - 1] ?? null,
      dropiPrice: item.dropiPriceRef,
      marginApprox: top && item.dropiPriceRef != null ? Math.round((top.price - item.dropiPriceRef * top.units) * 100) / 100 : null,
      qtyMix: qtyTotal >= 5 ? { one: Math.round((a.qty.one / qtyTotal) * 100), two: Math.round((a.qty.two / qtyTotal) * 100), threePlus: Math.round((a.qty.threePlus / qtyTotal) * 100) } : null,
      cities,
      women: knownGender >= MIN_GENDER_GUIDES ? Math.round((a.women / knownGender) * 100) : null,
      deliveryRate: d && d.sent >= MIN_DELIVERY_GUIDES ? Math.round(((d.sent - d.returned) / d.sent) * 100) : null,
      combos: [...a.combos.entries()]
        .sort((x, y) => y[1].units - x[1].units)
        .slice(0, 3)
        .map(([code, c]) => ({ code, name: comboNames.get(code) ?? code, photos: comboPhotos.get(code) ?? [], unitsRange: unitsRange(c.units), price: topKey(c.prices) })),
      rank: 0,
    } });
  }
  const products = ranked.sort((x, y) => y.units - x.units).map((r, i) => ({ ...r.product, rank: i + 1 }));

  return { day: today, windowFrom, windowTo, products, guides: windowGuides };
}

// Lo corre el cron diario; también el botón "Recalcular ahora" del admin.
export async function saveProvedixSnapshot(): Promise<ProvedixSnapshotData> {
  const data = await buildProvedixSnapshot();
  const json = data as unknown as Prisma.InputJsonValue;
  await prisma.provedixSnapshot.upsert({ where: { day: data.day }, create: { day: data.day, data: json }, update: { data: json, createdAt: new Date() } });
  // Solo se guardan los últimos 60 días.
  await prisma.provedixSnapshot.deleteMany({ where: { day: { lt: shiftDay(data.day, -60) } } });
  return data;
}

export async function getLatestProvedixSnapshot(): Promise<(ProvedixSnapshotData & { generatedAt: string }) | null> {
  const row = await prisma.provedixSnapshot.findFirst({ orderBy: { day: "desc" } });
  return row ? { ...(row.data as unknown as ProvedixSnapshotData), generatedAt: row.createdAt.toISOString() } : null;
}
